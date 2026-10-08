import { generateObject, NoObjectGeneratedError } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { z } from 'zod';
import type { EngineConfig } from '../config.js';
import type { ModelCallOptions, ModelClient, ModelResult } from './model-client.js';

/** Rough per-1M-token prices for cost telemetry. Config, not business logic. */
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'gpt-5': { input: 1.25, output: 10 },
  default: { input: 3, output: 15 },
};

/** Vercel AI SDK implementation. Anthropic for diagnosis/fix, OpenAI for QA. No Gemini (ADR-004). */
export class VercelModelClient implements ModelClient {
  readonly commercialUse = true;

  constructor(private readonly config: EngineConfig) {}

  get modelConfigVersion(): string {
    return this.config.models.modelConfigVersion;
  }

  private resolve(model: string) {
    if (model.startsWith('claude')) {
      // An org-level key not scoped to one workspace fails every request with "This API key is not
      // scoped to a workspace" unless this header names which workspace to bill/run under (seen
      // live). Only added when configured — a workspace-scoped key never needs it.
      const headers = this.config.keys.anthropicWorkspaceId
        ? { 'anthropic-workspace-id': this.config.keys.anthropicWorkspaceId }
        : undefined;
      const anthropic = createAnthropic({
        apiKey: this.config.keys.anthropic ?? this.config.keys.gateway ?? '',
        headers,
      });
      return anthropic(model);
    }
    if (model.startsWith('gpt') || model.startsWith('o')) {
      const openai = createOpenAI({ apiKey: this.config.keys.openai ?? this.config.keys.gateway ?? '' });
      return openai(model);
    }
    throw new Error(`Unsupported model family for "${model}". Gemini is not supported in the CRO runtime.`);
  }

  async generateStructured<T>(
    model: string,
    schema: z.ZodType<T>,
    options: ModelCallOptions,
  ): Promise<ModelResult<T>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await generateObject({
          model: this.resolve(model),
          schema: schema as any,
          system: options.system,
          prompt: buildPrompt(options, model) as any,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 4000,
          providerOptions: buildProviderOptions(options, model) as any,
        });
        const price = PRICE_TABLE[model] ?? PRICE_TABLE.default!;
        const inputTokens = result.usage?.inputTokens ?? 0;
        const outputTokens = result.usage?.outputTokens ?? 0;
        return {
          data: result.object as T,
          usage: {
            stage: options.stage,
            model,
            inputTokens,
            outputTokens,
            estimatedCostUsd:
              (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output,
            attempts: attempt,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `Model call failed for stage ${options.stage} after 3 attempts: ${describeModelError(lastError)}`,
    );
  }
}

/**
 * When the caller provides `cacheableContext` (normally the fenced evidence payload — large and
 * byte-identical across a stage's repeated calls and across one call's own internal retries), marks
 * it as an Anthropic prompt-cache breakpoint ahead of the task-specific `prompt` text. A repeat with
 * the same prefix is served from cache instead of being reprocessed from scratch: faster and
 * cheaper. OpenAI (the QA stage) already caches long, repeated prompt prefixes automatically with no
 * special markup, so this only needs to do anything for Claude models.
 */
export function buildPrompt(options: ModelCallOptions, model: string): string | Array<Record<string, unknown>> {
  if (!options.cacheableContext || !model.startsWith('claude')) {
    return options.cacheableContext ? `${options.cacheableContext}\n\n${options.prompt}` : options.prompt;
  }
  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: options.cacheableContext,
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
        { type: 'text', text: options.prompt },
      ],
    },
  ];
}

/**
 * OpenAI-family "reasoning models" (gpt-5 etc.) spend hidden reasoning tokens before emitting output,
 * which the default (`medium`) effort does even for a bounded classification task — measured live as
 * the single biggest avoidable chunk of the QA stage's wall time. No-op for Anthropic (and for any
 * caller that doesn't set these fields): only passed through when actually requested.
 */
export function buildProviderOptions(
  options: ModelCallOptions,
  model: string,
): Record<string, Record<string, unknown>> | undefined {
  if (model.startsWith('claude')) return undefined;
  if (!options.reasoningEffort && !options.textVerbosity) return undefined;
  return {
    openai: {
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.textVerbosity ? { textVerbosity: options.textVerbosity } : {}),
    },
  };
}

interface ZodLikeIssue {
  path?: Array<string | number>;
  message?: string;
}

/** Duck-types Zod's error shape without importing zod's internal error class directly. */
function extractZodIssues(error: unknown): ZodLikeIssue[] | null {
  const issues = (error as { issues?: unknown })?.issues;
  return Array.isArray(issues) ? (issues as ZodLikeIssue[]) : null;
}

/**
 * For an "Expected array, received string" issue, walks `value` to the offending field and tries
 * JSON.parse on it directly, reporting the exact SyntaxError (position included) and enough of the
 * string around that position to see what's actually there — instead of guessing from a slice of
 * unrelated raw text.
 */
function diagnoseStringField(value: unknown, issues: ZodLikeIssue[] | null): string {
  const target = issues?.find((issue) => issue.message === 'Expected array, received string');
  if (!target?.path || typeof value !== 'object' || value === null) return '';
  let node: unknown = value;
  for (const key of target.path) {
    if (typeof node !== 'object' || node === null) return '';
    node = (node as Record<string | number, unknown>)[key];
  }
  if (typeof node !== 'string') return '';
  try {
    JSON.parse(node);
    return ` | stringFieldParsesFine(len=${node.length})`;
  } catch (parseError) {
    const message = String((parseError as Error)?.message ?? parseError);
    return ` | stringFieldParseError="${message}" len=${node.length} tail="${node.slice(-200)}"`;
  }
}

/**
 * `AI_NoObjectGeneratedError` normally just says "response did not match schema" with no detail on
 * WHICH field was wrong — a live failure was undiagnosable from the job's error field alone even
 * after adding `.text`/`.cause`, because both were dumped as truncated raw JSON instead of the actual
 * Zod issue. The real chain is NoObjectGeneratedError.cause -> TypeValidationError.cause -> ZodError
 * (with `.issues`); this walks it and reports "path: message" for each concrete issue when present.
 */
function describeModelError(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    const typeValidationError = error.cause as { cause?: unknown; value?: unknown } | undefined;
    const zodIssues = extractZodIssues(typeValidationError?.cause) ?? extractZodIssues(error.cause);
    const issueSummary = zodIssues
      ? zodIssues.map((issue) => `${(issue.path ?? []).join('.') || '(root)'}: ${issue.message ?? 'invalid'}`).join(' | ')
      : null;
    // For the specific "expected array, received string" shape: the outer JSON already parsed fine
    // (that's how we have a typed `value` at all) — try to JSON.parse the offending string field
    // directly and report the exact parse error, instead of guessing from a truncated text dump.
    const stringFieldDiagnosis = diagnoseStringField(typeValidationError?.value, zodIssues);
    const rawText = error.text ? error.text.slice(0, 4000) : '(no raw text captured)';
    // finishReason="length" is the direct signal for a maxOutputTokens truncation, and it was
    // getting dropped whenever a Zod issue was ALSO found — exactly the case where knowing whether
    // the model ran out of tokens mid-generation (vs. genuinely produced a wrong shape) matters most.
    return issueSummary
      ? `${error.message} | finishReason=${error.finishReason} | issues: ${issueSummary}${stringFieldDiagnosis} | rawText=${rawText}`
      : `${error.message} | finishReason=${error.finishReason} | cause=${String((error.cause as Error)?.message ?? error.cause).slice(0, 800)} | rawText=${rawText}`;
  }
  return String(error);
}

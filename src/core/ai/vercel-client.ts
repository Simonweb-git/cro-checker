import { generateObject } from 'ai';
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
      const anthropic = createAnthropic({ apiKey: this.config.keys.anthropic ?? this.config.keys.gateway ?? '' });
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
          prompt: options.prompt,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 4000,
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
    throw new Error(`Model call failed for stage ${options.stage} after 3 attempts: ${String(lastError)}`);
  }
}

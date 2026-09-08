import type { z } from 'zod';

/**
 * The only surface the engine uses to talk to a model (ADR-005).
 * Stage code never imports a vendor SDK, so stages are testable with a fake client.
 */
export interface ModelCallOptions {
  /** Trusted instructions. Scraped content must NEVER be placed here. */
  system: string;
  /** Trusted task framing; untrusted evidence is fenced inside by the caller. */
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  stage: string;
}

export interface ModelUsage {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  attempts: number;
}

export interface ModelResult<T> {
  data: T;
  usage: ModelUsage;
}

export interface ModelClient {
  readonly modelConfigVersion: string;
  readonly commercialUse: boolean;
  generateStructured<T>(
    model: string,
    schema: z.ZodType<T>,
    options: ModelCallOptions,
  ): Promise<ModelResult<T>>;
}

export class ModelBudgetExceededError extends Error {
  constructor(kind: 'calls' | 'tokens') {
    super(`Model budget exceeded: ${kind}`);
    this.name = 'ModelBudgetExceededError';
  }
}

/** Enforces per-analysis model budgets around any client (build spec §19). */
export class BudgetedModelClient implements ModelClient {
  private calls = 0;
  private tokens = 0;
  readonly usages: ModelUsage[] = [];

  constructor(
    private readonly inner: ModelClient,
    private readonly budget: { maxModelCalls: number; maxTokens: number },
  ) {}

  get modelConfigVersion(): string {
    return this.inner.modelConfigVersion;
  }
  get commercialUse(): boolean {
    return this.inner.commercialUse;
  }

  async generateStructured<T>(model: string, schema: z.ZodType<T>, options: ModelCallOptions) {
    if (this.calls >= this.budget.maxModelCalls) throw new ModelBudgetExceededError('calls');
    if (this.tokens >= this.budget.maxTokens) throw new ModelBudgetExceededError('tokens');
    this.calls += 1;
    const result = await this.inner.generateStructured(model, schema, options);
    this.tokens += result.usage.inputTokens + result.usage.outputTokens;
    this.usages.push(result.usage);
    return result;
  }

  totals() {
    return this.usages.reduce(
      (acc, u) => ({
        modelCalls: acc.modelCalls + 1,
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        estimatedCostUsd: Number((acc.estimatedCostUsd + u.estimatedCostUsd).toFixed(6)),
      }),
      { modelCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    );
  }
}

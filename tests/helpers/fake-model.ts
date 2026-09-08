import type { z } from 'zod';
import type { ModelCallOptions, ModelClient, ModelResult } from '../../src/core/ai/model-client.js';

/** Scripted model for stage tests: no network, exact control over what a stage receives back. */
export class FakeModelClient implements ModelClient {
  readonly modelConfigVersion = 'fake';
  readonly commercialUse = true;
  readonly calls: ModelCallOptions[] = [];

  constructor(private readonly responses: Record<string, unknown>) {}

  async generateStructured<T>(
    model: string,
    schema: z.ZodType<T>,
    options: ModelCallOptions,
  ): Promise<ModelResult<T>> {
    this.calls.push(options);
    const key = Object.keys(this.responses).find((k) => options.stage === k || options.stage.startsWith(k));
    if (key === undefined) throw new Error(`FakeModelClient has no response for stage ${options.stage}`);
    return {
      data: schema.parse(this.responses[key]),
      usage: { stage: options.stage, model, inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0, attempts: 1 },
    };
  }
}

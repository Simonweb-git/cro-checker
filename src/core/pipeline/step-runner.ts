import type { AnalysisRepository } from '../persistence/repository.js';

export interface StepContext {
  analysisId: string;
  durations: Record<string, number>;
}

/**
 * Durable step execution (ADR-002). A completed step is replayed from storage rather than re-run,
 * which is what makes retries idempotent. Swap this for a Vercel Workflows adapter without touching
 * any stage code.
 */
export interface WorkflowRunner {
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export class LocalStepRunner implements WorkflowRunner {
  constructor(
    private readonly repository: AnalysisRepository,
    private readonly context: StepContext,
    private readonly options: { replay: boolean } = { replay: true },
  ) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.options.replay) {
      const existing = await this.repository.getStep(this.context.analysisId, name);
      if (existing) {
        this.context.durations[name] = existing.durationMs;
        return existing.output as T;
      }
    }
    const started = Date.now();
    const output = await fn();
    const durationMs = Date.now() - started;
    this.context.durations[name] = durationMs;
    await this.repository.saveStep({
      analysisId: this.context.analysisId,
      step: name,
      output,
      durationMs,
      completedAt: new Date().toISOString(),
    });
    return output;
  }
}

import type { AnalysisJob, JobStage } from '../schemas/job.js';
import type { FinalReport } from '../schemas/report.js';

/** Everything the pipeline persists. Raw HTML is never stored after extraction (build spec §18). */
export interface StepRecord {
  analysisId: string;
  step: string;
  output: unknown;
  durationMs: number;
  completedAt: string;
}

export interface AnalysisRepository {
  createJob(job: AnalysisJob): Promise<void>;
  getJob(analysisId: string): Promise<AnalysisJob | null>;
  updateJob(analysisId: string, patch: Partial<AnalysisJob>): Promise<void>;
  setStage(analysisId: string, stage: JobStage): Promise<void>;
  saveStep(record: StepRecord): Promise<void>;
  getStep(analysisId: string, step: string): Promise<StepRecord | null>;
  saveReport(analysisId: string, report: FinalReport): Promise<void>;
  getReport(analysisId: string): Promise<FinalReport | null>;
}

export class InMemoryRepository implements AnalysisRepository {
  private jobs = new Map<string, AnalysisJob>();
  private steps = new Map<string, StepRecord>();
  private reports = new Map<string, FinalReport>();

  async createJob(job: AnalysisJob): Promise<void> {
    this.jobs.set(job.analysisId, job);
  }
  async getJob(analysisId: string): Promise<AnalysisJob | null> {
    return this.jobs.get(analysisId) ?? null;
  }
  async updateJob(analysisId: string, patch: Partial<AnalysisJob>): Promise<void> {
    const existing = this.jobs.get(analysisId);
    if (!existing) throw new Error(`Unknown analysis ${analysisId}`);
    this.jobs.set(analysisId, { ...existing, ...patch, updatedAt: new Date().toISOString() });
  }
  async setStage(analysisId: string, stage: JobStage): Promise<void> {
    await this.updateJob(analysisId, { stage });
  }
  async saveStep(record: StepRecord): Promise<void> {
    this.steps.set(`${record.analysisId}:${record.step}`, record);
  }
  async getStep(analysisId: string, step: string): Promise<StepRecord | null> {
    return this.steps.get(`${analysisId}:${step}`) ?? null;
  }
  async saveReport(analysisId: string, report: FinalReport): Promise<void> {
    this.reports.set(analysisId, report);
  }
  async getReport(analysisId: string): Promise<FinalReport | null> {
    return this.reports.get(analysisId) ?? null;
  }
}

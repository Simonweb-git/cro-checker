import { z } from 'zod';

/** Workflow states, verbatim from build spec §7. */
export const JobStage = z.enum([
  'queued',
  'validating_url',
  'discovering_pages',
  'extracting_pages',
  'measuring_performance',
  'scoring',
  'diagnosing',
  'generating_fixes',
  'qa_review',
  'assembling_report',
  'completed',
  'partial',
  'failed',
]);
export type JobStage = z.infer<typeof JobStage>;

export const TERMINAL_STAGES: JobStage[] = ['completed', 'partial', 'failed'];

/** Legal transitions. Enforced by the state machine so a retry cannot move a job backwards. */
export const STAGE_ORDER: JobStage[] = [
  'queued',
  'validating_url',
  'discovering_pages',
  'extracting_pages',
  'measuring_performance',
  'scoring',
  'diagnosing',
  'generating_fixes',
  'qa_review',
  'assembling_report',
];

export const AnalysisJob = z.object({
  analysisId: z.string(),
  rootUrl: z.string(),
  stage: JobStage,
  createdAt: z.string(),
  updatedAt: z.string(),
  selectedPages: z.array(z.object({ url: z.string(), pageType: z.string(), selectionReason: z.string() })),
  error: z.string().nullable(),
  partialReasons: z.array(z.string()),
});
export type AnalysisJob = z.infer<typeof AnalysisJob>;

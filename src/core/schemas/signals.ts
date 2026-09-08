import { z } from 'zod';
import { Confidence, EvidenceRef, SignalValue } from './common.js';

/** One bounded classification. An LLM returns these; code turns them into scores (ADR-003). */
export const SignalAssessment = z.object({
  signalId: z.string(),
  value: SignalValue,
  evidenceRefs: z.array(EvidenceRef),
  confidence: Confidence,
  rationale: z.string().max(400),
});
export type SignalAssessment = z.infer<typeof SignalAssessment>;

export const SignalAssessmentSet = z.object({
  schemaVersion: z.literal('signals-v1'),
  analysisId: z.string(),
  assessments: z.array(SignalAssessment),
});
export type SignalAssessmentSet = z.infer<typeof SignalAssessmentSet>;

/** Batched model output for one category. Values only — no scores. */
export const SignalBatchOutput = z.object({
  assessments: z.array(
    z.object({
      signalId: z.string(),
      value: SignalValue,
      evidenceRefs: z.array(z.string()),
      confidence: Confidence,
      rationale: z.string().max(400),
    }),
  ),
});
export type SignalBatchOutput = z.infer<typeof SignalBatchOutput>;

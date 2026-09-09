import { z } from 'zod';
import { Confidence, EvidenceRef, SignalValue, lenientArray } from './common.js';

/** Domain cap for a rationale once it is in the final, validated report. */
export const RATIONALE_MAX_LENGTH = 500;

/** One bounded classification. An LLM returns these; code turns them into scores (ADR-003). */
export const SignalAssessment = z.object({
  signalId: z.string(),
  value: SignalValue,
  evidenceRefs: z.array(EvidenceRef),
  confidence: Confidence,
  rationale: z.string().max(RATIONALE_MAX_LENGTH),
});
export type SignalAssessment = z.infer<typeof SignalAssessment>;

export const SignalAssessmentSet = z.object({
  schemaVersion: z.literal('signals-v1'),
  analysisId: z.string(),
  assessments: z.array(SignalAssessment),
});
export type SignalAssessmentSet = z.infer<typeof SignalAssessmentSet>;

/**
 * Batched model output for one category. Deliberately has NO length cap on rationale: Anthropic (and
 * most providers) constrain generated JSON to the right STRUCTURE/types via tool-calling, but do not
 * reliably enforce a Zod `.max()` string-length constraint during generation. A model writing a
 * genuinely good, evidence-grounded rationale that runs a little long then fails the SDK's own
 * post-generation schema re-validation and the entire batch is lost — this happened live. The
 * strict RATIONALE_MAX_LENGTH cap is enforced in code afterward (runSignalStage), by truncating
 * rather than rejecting.
 */
export const SignalBatchOutput = z.object({
  assessments: lenientArray(
    z.array(
      z.object({
        signalId: z.string(),
        value: SignalValue,
        evidenceRefs: lenientArray(z.array(z.string())),
        confidence: Confidence,
        rationale: z.string(),
      }),
    ),
  ),
});
export type SignalBatchOutput = z.infer<typeof SignalBatchOutput>;

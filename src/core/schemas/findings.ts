import { z } from 'zod';
import { Confidence, EvidenceRef, ExpectedImpact, PageId, Severity } from './common.js';

/**
 * Required finding fields, verbatim from reasoning spec §8.
 *
 * Length caps are generous (not the tight display-oriented limits an earlier version used): a live
 * failure showed a provider's tool-calling does not hard-enforce a Zod `.max()` string length during
 * generation, only structure/types, so a genuinely good, evidence-grounded answer that ran a little
 * long failed the SDK's post-generation re-validation and the whole batch was lost. This schema is
 * shared between generation and storage, so the cap has to be sized for the model, not the UI.
 */
export const DiagnosticFinding = z.object({
  findingId: z.string().regex(/^f_[a-z0-9_]+$/),
  title: z.string().max(200),
  severity: Severity,
  expectedImpact: ExpectedImpact,
  affectedPages: z.array(PageId).min(1),
  evidenceRefs: z.array(EvidenceRef).min(1),
  observedFact: z.string().max(1500),
  croInference: z.string().max(1500),
  whyItHurts: z.string().max(1500),
  /** A direction, not final replacement copy — that belongs to the Fix stage. */
  recommendedDirection: z.string().max(1500),
  confidence: Confidence,
  /** Set when the finding asserts something is absent; gated on extraction coverage (ADR-010). */
  assertsAbsence: z.boolean(),
});
export type DiagnosticFinding = z.infer<typeof DiagnosticFinding>;

export const DiagnosticOutput = z.object({
  findings: z.array(DiagnosticFinding).min(0).max(5),
});
export type DiagnosticOutput = z.infer<typeof DiagnosticOutput>;

export const DiagnosticFindings = z.object({
  schemaVersion: z.literal('findings-v1'),
  analysisId: z.string(),
  findings: z.array(DiagnosticFinding).max(5),
  droppedFindings: z.array(z.object({ title: z.string(), reason: z.string() })),
});
export type DiagnosticFindings = z.infer<typeof DiagnosticFindings>;

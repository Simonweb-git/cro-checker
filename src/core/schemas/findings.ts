import { z } from 'zod';
import { Confidence, EvidenceRef, ExpectedImpact, PageId, Severity } from './common.js';

/** Required finding fields, verbatim from reasoning spec §8. */
export const DiagnosticFinding = z.object({
  findingId: z.string().regex(/^f_[a-z0-9_]+$/),
  title: z.string().max(120),
  severity: Severity,
  expectedImpact: ExpectedImpact,
  affectedPages: z.array(PageId).min(1),
  evidenceRefs: z.array(EvidenceRef).min(1),
  observedFact: z.string().max(700),
  croInference: z.string().max(700),
  whyItHurts: z.string().max(700),
  /** A direction, not final replacement copy — that belongs to the Fix stage. */
  recommendedDirection: z.string().max(700),
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

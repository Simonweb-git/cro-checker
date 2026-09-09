import { z } from 'zod';
import { Confidence, ConversionGoal, EvidenceRef, PageId, SiteArchetype, lenientArray } from './common.js';

const Inference = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    confidence: Confidence,
    evidenceRefs: lenientArray(z.array(EvidenceRef)),
  });

/**
 * What the SiteContext AI stage is allowed to return. Nothing else is accepted.
 * Generous, generation-safe string caps — see the comment on DiagnosticFinding in findings.ts
 * (a live failure hit exactly this pattern in `notes`, which had a tighter max(600)).
 */
export const SiteContextOutput = z.object({
  siteArchetype: Inference(SiteArchetype),
  primaryConversionGoal: Inference(ConversionGoal),
  primaryICP: Inference(z.string().max(600)),
  secondaryICP: Inference(z.string().max(600)).nullable(),
  dominantLanguage: z.string().max(12).nullable(),
  /** True only when the current lead-gen rubric must not be applied. */
  unsupportedArchetype: z.boolean(),
  primaryConversionPageId: PageId.nullable(),
  notes: z.string().max(1200).optional(),
});
export type SiteContextOutput = z.infer<typeof SiteContextOutput>;

export const SiteContext = SiteContextOutput.extend({
  schemaVersion: z.literal('sitecontext-v1'),
  analysisId: z.string(),
  /** Resolved report language: configured value, else detected, else 'en' (ADR-012). */
  reportLanguage: z.string(),
  reportLanguageSource: z.enum(['configured', 'detected', 'fallback']),
});
export type SiteContext = z.infer<typeof SiteContext>;

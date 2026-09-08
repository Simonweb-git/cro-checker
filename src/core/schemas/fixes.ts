import { z } from 'zod';
import { EvidenceRef, ExpectedImpact, PageId } from './common.js';

const FixBase = {
  fixId: z.string().regex(/^fx_[a-z0-9_]+$/),
  findingId: z.string(),
  pageId: PageId,
  placement: z.string().max(160),
  currentIssue: z.string().max(500),
  whatToChange: z.string().max(500),
  rationale: z.string().max(500),
  evidenceRefs: z.array(EvidenceRef).min(1),
};

export const HeroFix = z.object({
  ...FixBase,
  kind: z.literal('hero'),
  /** Up to three alternatives, only when a hero issue was validated (reasoning spec §10). */
  alternatives: z
    .array(z.object({ headline: z.string().max(160), subheadline: z.string().max(300) }))
    .max(3),
});

export const CtaFix = z.object({
  ...FixBase,
  kind: z.literal('cta'),
  /** A coherent strategy, not arbitrary labels. */
  strategy: z.string().max(400),
  recommendations: z
    .array(
      z.object({
        label: z.string().max(80),
        role: z.enum(['primary_high_intent', 'secondary_low_friction', 'supporting']),
        placement: z.string().max(160),
      }),
    )
    .max(4),
});

export const CopyFix = z.object({
  ...FixBase,
  kind: z.literal('copy'),
  currentCopy: z.string().max(600).nullable(),
  proposedCopy: z.string().max(600),
});

/** Used when evidence cannot support accurate replacement copy (reasoning spec §10). */
export const StructuralFix = z.object({
  ...FixBase,
  kind: z.literal('structural'),
  recommendation: z.string().max(600),
});

export const Fix = z.discriminatedUnion('kind', [HeroFix, CtaFix, CopyFix, StructuralFix]);
export type Fix = z.infer<typeof Fix>;

export const FixOutput = z.object({ fixes: z.array(Fix).max(12) });
export type FixOutput = z.infer<typeof FixOutput>;

export const ActionItem = z.object({
  actionId: z.string(),
  action: z.string().max(240),
  findingId: z.string(),
  expectedImpact: ExpectedImpact,
  effort: z.enum(['quick_win', 'requires_deeper_work']),
  pageId: PageId.nullable(),
});
export type ActionItem = z.infer<typeof ActionItem>;

export const FixSet = z.object({
  schemaVersion: z.literal('fixes-v1'),
  analysisId: z.string(),
  fixes: z.array(Fix),
  droppedFixes: z.array(z.object({ fixId: z.string(), reason: z.string() })),
});
export type FixSet = z.infer<typeof FixSet>;

import { z } from 'zod';
import { EvidenceRef, ExpectedImpact, PageId, lenientArray } from './common.js';

// Generous, generation-safe caps — see the comment on DiagnosticFinding in findings.ts for why
// (Anthropic's tool-calling does not hard-enforce Zod .max() string length during generation).
// Array fields go through lenientArray for the same reason a live failure showed: a model can emit
// an array-typed field as a JSON-encoded string instead of a native array.
const FixBase = {
  fixId: z.string().regex(/^fx_[a-z0-9_]+$/),
  findingId: z.string(),
  pageId: PageId,
  placement: z.string().max(300),
  currentIssue: z.string().max(1200),
  whatToChange: z.string().max(1200),
  rationale: z.string().max(1200),
  evidenceRefs: lenientArray(z.array(EvidenceRef).min(1)),
};

export const HeroFix = z.object({
  ...FixBase,
  kind: z.literal('hero'),
  /** Up to three alternatives, only when a hero issue was validated (reasoning spec §10). */
  alternatives: lenientArray(
    z.array(z.object({ headline: z.string().max(300), subheadline: z.string().max(500) })).max(3),
  ),
});

export const CtaFix = z.object({
  ...FixBase,
  kind: z.literal('cta'),
  /** A coherent strategy, not arbitrary labels. */
  strategy: z.string().max(900),
  recommendations: lenientArray(
    z
      .array(
        z.object({
          label: z.string().max(120),
          role: z.enum(['primary_high_intent', 'secondary_low_friction', 'supporting']),
          placement: z.string().max(300),
        }),
      )
      .max(4),
  ),
});

export const CopyFix = z.object({
  ...FixBase,
  kind: z.literal('copy'),
  currentCopy: z.string().max(1200).nullable(),
  proposedCopy: z.string().max(1200),
});

/** Used when evidence cannot support accurate replacement copy (reasoning spec §10). */
export const StructuralFix = z.object({
  ...FixBase,
  kind: z.literal('structural'),
  recommendation: z.string().max(1200),
});

export const Fix = z.discriminatedUnion('kind', [HeroFix, CtaFix, CopyFix, StructuralFix]);
export type Fix = z.infer<typeof Fix>;

export const FixOutput = z.object({ fixes: lenientArray(z.array(Fix).max(12)) });
export type FixOutput = z.infer<typeof FixOutput>;

export const ActionItem = z.object({
  actionId: z.string(),
  action: z.string().max(1200),
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

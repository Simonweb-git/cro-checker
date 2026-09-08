import { z } from 'zod';
import { EvidenceRef } from './common.js';

export const UnavailableReason = z.enum([
  'insufficient_evidence',
  'insufficient_pages',
  'no_measurement',
  'insufficient_category_coverage',
  'not_applicable_archetype',
]);
export type UnavailableReason = z.infer<typeof UnavailableReason>;

export const AppliedPenalty = z.object({
  penaltyId: z.string(),
  points: z.number(),
  trigger: z.string(),
});

export const CategoryScore = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    categoryId: z.string(),
    label: z.string(),
    score: z.number().int().min(0).max(100),
    band: z.enum(['Excellent', 'Strong', 'Average', 'Weak', 'Critical']),
    contributingSignals: z.array(
      z.object({
        signalId: z.string(),
        value: z.union([z.number(), z.string()]),
        baseWeight: z.number(),
        effectiveWeight: z.number(),
        points: z.number().nullable(),
        evidenceRefs: z.array(EvidenceRef),
      }),
    ),
    penalties: z.array(AppliedPenalty),
  }),
  z.object({
    status: z.literal('unavailable'),
    categoryId: z.string(),
    label: z.string(),
    reason: UnavailableReason,
    detail: z.string().optional(),
  }),
]);
export type CategoryScore = z.infer<typeof CategoryScore>;

export const OverallScore = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    score: z.number().int().min(0).max(100),
    band: z.enum(['Excellent', 'Strong', 'Average', 'Weak', 'Critical']),
    availableWeight: z.number(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: UnavailableReason,
    detail: z.string().optional(),
  }),
]);
export type OverallScore = z.infer<typeof OverallScore>;

export const ScoreSet = z.object({
  schemaVersion: z.literal('scores-v1'),
  analysisId: z.string(),
  scoringVersion: z.string(),
  overall: OverallScore,
  dashboard: z.array(CategoryScore),
  consistency: z.array(CategoryScore),
});
export type ScoreSet = z.infer<typeof ScoreSet>;

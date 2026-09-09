import { z } from 'zod';
import { EvidenceRef, PageId, lenientArray } from './common.js';
import { ScoreSet } from './scores.js';
import { DiagnosticFinding } from './findings.js';
import { ActionItem, Fix } from './fixes.js';
import { SiteContext } from './context.js';
import { VersionStamp } from './common.js';
import { QAResults } from './qa.js';

/**
 * Narration of a code-computed score. The model never adjusts the number (reasoning spec §12).
 * Generous, generation-safe caps — see the comment on DiagnosticFinding in findings.ts.
 */
export const ScoreNarration = z.object({
  categoryId: z.string(),
  status: z.enum(['available', 'unavailable']),
  primaryReason: z.string().max(500),
  biggestImprovementOpportunity: z.string().max(500),
  supportingEvidenceRefs: lenientArray(z.array(EvidenceRef)),
});
export type ScoreNarration = z.infer<typeof ScoreNarration>;

export const NarrationOutput = z.object({
  executiveSummary: z.string(),
  narrations: lenientArray(z.array(ScoreNarration)),
  consistencyAnalysis: z.string().max(2500),
  trustReview: z.string().max(1800),
  performanceImpact: z.string().max(1500),
});
export type NarrationOutput = z.infer<typeof NarrationOutput>;

export const AnalyzedPage = z.object({
  pageId: PageId,
  url: z.string(),
  pageType: z.string(),
  selectionReason: z.string(),
});

/** Returned instead of a dashboard when the archetype is out of rubric scope (reasoning spec §16). */
export const UnsupportedArchetypeReport = z.object({
  kind: z.literal('unsupported_archetype'),
  schemaVersion: z.literal('report-v1'),
  analysisId: z.string(),
  rootUrl: z.string(),
  detectedArchetype: z.string(),
  explanation: z.string(),
  extractedContext: z.object({
    primaryConversionGoal: z.string().nullable(),
    primaryICP: z.string().nullable(),
    analyzedPages: z.array(AnalyzedPage),
  }),
  versions: VersionStamp,
  commercialUse: z.boolean(),
});

export const StandardReport = z.object({
  kind: z.literal('cro_health_check'),
  schemaVersion: z.literal('report-v1'),
  analysisId: z.string(),
  rootUrl: z.string(),
  generatedAt: z.string(),
  reportLanguage: z.string(),
  completeness: z.enum(['complete', 'partial']),
  partialReasons: z.array(z.string()),
  /** False when the deterministic stub provider produced the reasoning (ADR-006). */
  commercialUse: z.boolean(),
  analyzedPages: z.array(AnalyzedPage),
  failedPages: z.array(z.object({ url: z.string(), reason: z.string() })),
  scores: ScoreSet,
  narrations: z.array(ScoreNarration),
  executiveSummary: z.string(),
  siteContext: SiteContext,
  findings: z.array(DiagnosticFinding),
  consistencyAnalysis: z.string(),
  fixes: z.array(Fix),
  trustReview: z.string(),
  performanceImpact: z.string(),
  actionPlan: z.array(ActionItem).max(10),
  qa: QAResults,
  versions: VersionStamp,
  telemetry: z.object({
    stageDurationsMs: z.record(z.string(), z.number()),
    modelCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    estimatedCostUsd: z.number(),
    crawlRequests: z.number().int(),
    crawlBytes: z.number().int(),
  }),
});
export type StandardReport = z.infer<typeof StandardReport>;

export const FinalReport = z.discriminatedUnion('kind', [StandardReport, UnsupportedArchetypeReport]);
export type FinalReport = z.infer<typeof FinalReport>;

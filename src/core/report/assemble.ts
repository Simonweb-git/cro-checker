import type { WebsiteEvidence } from '../schemas/evidence.js';
import type { SiteContext } from '../schemas/context.js';
import type { ScoreSet } from '../schemas/scores.js';
import type { DiagnosticFindings } from '../schemas/findings.js';
import type { ActionItem, FixSet } from '../schemas/fixes.js';
import type { QAResults } from '../schemas/qa.js';
import { FinalReport, StandardReport, type ScoreNarration } from '../schemas/report.js';
import type { VersionStamp } from '../schemas/common.js';

/**
 * Report assembly is CODE, not a model call. Ordering, caps and the action plan are deterministic so
 * the report cannot contradict the scores it presents (build spec §15).
 */

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const IMPACT_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const EFFORT_RANK: Record<string, number> = { quick_win: 0, requires_deeper_work: 1 };

export interface AssembleInput {
  analysisId: string;
  rootUrl: string;
  evidence: WebsiteEvidence;
  context: SiteContext;
  scores: ScoreSet;
  findings: DiagnosticFindings;
  fixes: FixSet;
  qa: QAResults;
  narration: {
    executiveSummary: string;
    narrations: ScoreNarration[];
    consistencyAnalysis: string;
    trustReview: string;
    performanceImpact: string;
  };
  versions: VersionStamp;
  commercialUse: boolean;
  partialReasons: string[];
  telemetry: StandardReport['telemetry'];
}

/** Ordered by likely conversion impact, then confidence, then effort (reasoning spec §14). */
export function buildActionPlan(findings: DiagnosticFindings, fixes: FixSet): ActionItem[] {
  const items: ActionItem[] = [];
  const findingById = new Map(findings.findings.map((f) => [f.findingId, f]));

  for (const fix of fixes.fixes) {
    const finding = findingById.get(fix.findingId);
    if (!finding) continue;
    items.push({
      actionId: `act_${fix.fixId}`,
      action: fix.whatToChange,
      findingId: fix.findingId,
      expectedImpact: finding.expectedImpact,
      effort: fix.kind === 'copy' || fix.kind === 'cta' ? 'quick_win' : 'requires_deeper_work',
      pageId: fix.pageId,
    });
  }
  // Findings with no surviving fix still deserve an action, mapped to the finding itself.
  for (const finding of findings.findings) {
    if (items.some((item) => item.findingId === finding.findingId)) continue;
    items.push({
      actionId: `act_${finding.findingId}`,
      action: finding.recommendedDirection,
      findingId: finding.findingId,
      expectedImpact: finding.expectedImpact,
      effort: 'requires_deeper_work',
      pageId: finding.affectedPages[0] ?? null,
    });
  }

  return items
    .sort((a, b) => {
      const impact = (IMPACT_RANK[a.expectedImpact] ?? 3) - (IMPACT_RANK[b.expectedImpact] ?? 3);
      if (impact !== 0) return impact;
      const confidenceA = CONFIDENCE_RANK[findingById.get(a.findingId)?.confidence ?? 'low'] ?? 2;
      const confidenceB = CONFIDENCE_RANK[findingById.get(b.findingId)?.confidence ?? 'low'] ?? 2;
      if (confidenceA !== confidenceB) return confidenceA - confidenceB;
      return (EFFORT_RANK[a.effort] ?? 1) - (EFFORT_RANK[b.effort] ?? 1);
    })
    .slice(0, 10);
}

export function assembleReport(input: AssembleInput): FinalReport {
  const analyzedPages = input.evidence.pages.map((page) => ({
    pageId: page.pageId,
    url: page.url,
    pageType: page.pageType,
    selectionReason: page.selectionReason,
  }));

  if (input.context.unsupportedArchetype || input.context.siteArchetype.value === 'ecommerce_unsupported') {
    return FinalReport.parse({
      kind: 'unsupported_archetype',
      schemaVersion: 'report-v1',
      analysisId: input.analysisId,
      rootUrl: input.rootUrl,
      detectedArchetype: input.context.siteArchetype.value,
      explanation:
        'This site appears to sell products directly online. The v1 scoring rubric is calibrated for lead-generation and consideration-driven websites, so a lead-gen CRO score would be misleading and is not produced.',
      extractedContext: {
        primaryConversionGoal: input.context.primaryConversionGoal.value,
        primaryICP: input.context.primaryICP.value,
        analyzedPages,
      },
      versions: input.versions,
      commercialUse: input.commercialUse,
    });
  }

  const findings = [...input.findings.findings].sort((a, b) => {
    const severity = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
    if (severity !== 0) return severity;
    return (IMPACT_RANK[a.expectedImpact] ?? 2) - (IMPACT_RANK[b.expectedImpact] ?? 2);
  });

  return FinalReport.parse({
    kind: 'cro_health_check',
    schemaVersion: 'report-v1',
    analysisId: input.analysisId,
    rootUrl: input.rootUrl,
    generatedAt: new Date().toISOString(),
    reportLanguage: input.context.reportLanguage,
    completeness: input.partialReasons.length > 0 ? 'partial' : 'complete',
    partialReasons: input.partialReasons,
    commercialUse: input.commercialUse,
    analyzedPages,
    failedPages: input.evidence.failedPages,
    scores: input.scores,
    narrations: input.narration.narrations,
    executiveSummary: input.narration.executiveSummary,
    siteContext: input.context,
    findings,
    consistencyAnalysis: input.narration.consistencyAnalysis,
    fixes: input.fixes.fixes,
    trustReview: input.narration.trustReview,
    performanceImpact: input.narration.performanceImpact,
    actionPlan: buildActionPlan(input.findings, input.fixes),
    qa: input.qa,
    versions: input.versions,
    telemetry: input.telemetry,
  });
}

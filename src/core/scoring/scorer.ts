import type { SignalAssessment } from '../schemas/signals.js';
import type { CategoryScore, OverallScore, ScoreSet } from '../schemas/scores.js';
import type { WebsiteEvidence } from '../schemas/evidence.js';
import type { SiteContext } from '../schemas/context.js';
import { GOAL_SATISFYING_INTENTS } from '../extract/intent.js';
import {
  CATEGORY_AVAILABILITY_THRESHOLD,
  CONSISTENCY_CATEGORIES,
  DASHBOARD_CATEGORIES,
  MAX_PENALTY_PER_CATEGORY,
  OVERALL_AVAILABILITY_THRESHOLD,
  PENALTIES,
  PERFORMANCE_METRICS,
  SCORING_VERSION,
  type CategoryDefinition,
} from './rubric.v1.js';

/** All 0-100 arithmetic lives here. No model ever produces one of these numbers (ADR-003). */

export type Band = 'Excellent' | 'Strong' | 'Average' | 'Weak' | 'Critical';

export function band(score: number): Band {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Average';
  if (score >= 40) return 'Weak';
  return 'Critical';
}

function confidenceFactor(confidence: SignalAssessment['confidence']): number {
  return confidence === 'low' ? 0.5 : 1;
}

function pointsFor(value: SignalAssessment['value']): number | null {
  return typeof value === 'number' ? (value / 4) * 100 : null;
}

/** Piecewise-linear metric → points, clamped to 0-100. */
export function metricPoints(value: number, good: number, mid: number, poor: number): number {
  if (value <= good) return 100;
  if (value >= poor) return 0;
  if (value <= mid) return 100 - ((value - good) / (mid - good)) * 50;
  return 50 - ((value - mid) / (poor - mid)) * 50;
}

export interface ScoringInput {
  analysisId: string;
  evidence: WebsiteEvidence;
  context: SiteContext;
  assessments: SignalAssessment[];
}

export function scoreCategory(
  definition: CategoryDefinition,
  assessments: SignalAssessment[],
  penalties: Array<{ penaltyId: string; points: number; trigger: string }>,
): CategoryScore {
  const byId = new Map(assessments.map((a) => [a.signalId, a]));
  const contributing = definition.signals.map((signal) => {
    const assessment = byId.get(signal.signalId);
    const value = assessment?.value ?? 'insufficient_evidence';
    const effectiveWeight = assessment ? signal.weight * confidenceFactor(assessment.confidence) : 0;
    return {
      signalId: signal.signalId,
      value,
      baseWeight: signal.weight,
      effectiveWeight: typeof value === 'number' ? effectiveWeight : 0,
      points: pointsFor(value),
      evidenceRefs: assessment?.evidenceRefs ?? [],
    };
  });

  const scorable = contributing.filter((c) => c.points !== null && c.effectiveWeight > 0);
  const applicableBaseWeight = definition.signals
    .filter((s) => byId.get(s.signalId)?.value !== 'not_applicable')
    .reduce((sum, s) => sum + s.weight, 0);
  const availableBaseWeight = scorable.reduce((sum, c) => sum + c.baseWeight, 0);

  if (
    applicableBaseWeight === 0 ||
    availableBaseWeight < CATEGORY_AVAILABILITY_THRESHOLD * applicableBaseWeight
  ) {
    return {
      status: 'unavailable',
      categoryId: definition.categoryId,
      label: definition.label,
      reason: definition.kind === 'consistency' ? 'insufficient_pages' : 'insufficient_evidence',
      detail: `Only ${(availableBaseWeight * 100).toFixed(0)}% of applicable signal weight could be judged from the evidence.`,
    };
  }

  const weightSum = scorable.reduce((sum, c) => sum + c.effectiveWeight, 0);
  const raw = scorable.reduce((sum, c) => sum + c.effectiveWeight * (c.points ?? 0), 0) / weightSum;
  const applicable = penalties.filter((p) =>
    PENALTIES.some((def) => def.penaltyId === p.penaltyId && def.categoryId === definition.categoryId),
  );
  const penaltyTotal = Math.min(
    MAX_PENALTY_PER_CATEGORY,
    applicable.reduce((sum, p) => sum + p.points, 0),
  );
  const score = Math.max(0, Math.min(100, Math.round(raw - penaltyTotal)));

  return {
    status: 'available',
    categoryId: definition.categoryId,
    label: definition.label,
    score,
    band: band(score),
    contributingSignals: contributing,
    penalties: applicable,
  };
}

export function scorePerformance(evidence: WebsiteEvidence): CategoryScore {
  const definition = DASHBOARD_CATEGORIES.find((c) => c.categoryId === 'performance_impact')!;
  const measurement =
    evidence.performance.find((m) => m.strategy === 'mobile') ?? evidence.performance[0];
  if (!measurement) {
    return {
      status: 'unavailable',
      categoryId: definition.categoryId,
      label: definition.label,
      reason: 'no_measurement',
      detail: 'No reliable performance measurement was collected. Speed is never estimated from page complexity.',
    };
  }
  const parts = PERFORMANCE_METRICS.map((m) => {
    const value = (measurement as Record<string, unknown>)[m.metric];
    if (typeof value !== 'number') return null;
    return { metric: m.metric, weight: m.weight, points: metricPoints(value, m.good, m.mid, m.poor), value };
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight < 0.5) {
    return {
      status: 'unavailable',
      categoryId: definition.categoryId,
      label: definition.label,
      reason: 'no_measurement',
      detail: 'The measurement returned too few usable metrics to score performance.',
    };
  }
  const score = Math.round(parts.reduce((sum, p) => sum + p.weight * p.points, 0) / totalWeight);
  return {
    status: 'available',
    categoryId: definition.categoryId,
    label: definition.label,
    score,
    band: band(score),
    contributingSignals: parts.map((p) => ({
      signalId: p.metric,
      value: p.value,
      baseWeight: p.weight,
      effectiveWeight: p.weight,
      points: p.points,
      evidenceRefs: [],
    })),
    penalties: [],
  };
}

/** Deterministic penalty triggers. Each requires evidence AND sufficient coverage (docs/SCORING.md §5). */
export function computePenalties(
  input: ScoringInput,
): Array<{ penaltyId: string; points: number; trigger: string }> {
  const { evidence, context, assessments } = input;
  const out: Array<{ penaltyId: string; points: number; trigger: string }> = [];
  const pages = evidence.pages;
  const coverageComplete = (key: 'conversionActions' | 'header' | 'footer') =>
    pages.length > 0 && pages.every((p) => p.coverage[key] === 'complete');

  const allActions = pages.flatMap((p) => p.conversionActions);
  const realActions = allActions.filter((a) => a.intent !== 'navigate' && a.intent !== 'unknown');
  if (realActions.length === 0 && coverageComplete('conversionActions')) {
    out.push({
      penaltyId: 'no_conversion_action',
      points: 25,
      trigger: `No conversion action or form detected across ${pages.length} analysed page(s) with complete extraction coverage.`,
    });
  }

  const goalPageId = context.primaryConversionPageId;
  const goalPage = goalPageId ? pages.find((p) => p.pageId === goalPageId) : undefined;
  if (goalPage && goalPage.coverage.conversionActions === 'complete') {
    const satisfying = GOAL_SATISFYING_INTENTS[context.primaryConversionGoal.value] ?? [];
    const hasMatch = goalPage.conversionActions.some((a) => satisfying.includes(a.intent));
    if (!hasMatch) {
      out.push({
        penaltyId: 'goal_page_missing_primary_action',
        points: 15,
        trigger: `${goalPage.pageId} (${goalPage.url}) is the primary conversion page but carries no action matching goal "${context.primaryConversionGoal.value}".`,
      });
    }
  }

  const hasContact =
    pages.some((p) => p.header.contactAffordance) ||
    pages.some((p) => p.footer.contact.length > 0) ||
    pages.some((p) => p.pageType === 'contact') ||
    allActions.some((a) => a.intent === 'contact' || a.intent === 'call');
  if (!hasContact && coverageComplete('footer') && coverageComplete('header')) {
    out.push({
      penaltyId: 'no_contact_affordance',
      points: 10,
      trigger: 'No contact affordance found in header, footer or as a contact action, with complete coverage.',
    });
  }

  const contradiction = assessments.find(
    (a) =>
      (a.signalId === 'value_prop_contradiction_absence' || a.signalId === 'buyer_compatibility') &&
      a.value === 0 &&
      a.evidenceRefs.length >= 2,
  );
  if (contradiction && pages.length >= 2) {
    out.push({
      penaltyId: 'cross_page_contradiction',
      points: 10,
      trigger: `Cross-page contradiction on signal "${contradiction.signalId}" (${contradiction.evidenceRefs.join(', ')}).`,
    });
  }

  return out;
}

export function computeScores(input: ScoringInput): ScoreSet {
  const penalties = computePenalties(input);
  const multiPage = input.evidence.pages.length >= 2;

  const dashboard: CategoryScore[] = DASHBOARD_CATEGORIES.map((definition) => {
    if (definition.objective) return scorePerformance(input.evidence);
    return scoreCategory(definition, input.assessments, penalties);
  });

  const consistency: CategoryScore[] = CONSISTENCY_CATEGORIES.map((definition) => {
    if (!multiPage) {
      return {
        status: 'unavailable' as const,
        categoryId: definition.categoryId,
        label: definition.label,
        reason: 'insufficient_pages' as const,
        detail: 'Cross-page consistency requires at least two successfully analysed pages.',
      };
    }
    return scoreCategory(definition, input.assessments, penalties);
  });

  const available = dashboard.filter(
    (c): c is Extract<CategoryScore, { status: 'available' }> => c.status === 'available',
  );
  const availableWeight = available.reduce(
    (sum, c) => sum + (DASHBOARD_CATEGORIES.find((d) => d.categoryId === c.categoryId)?.weight ?? 0),
    0,
  );

  let overall: OverallScore;
  if (availableWeight < OVERALL_AVAILABILITY_THRESHOLD) {
    overall = {
      status: 'unavailable',
      reason: 'insufficient_category_coverage',
      detail: `Only ${(availableWeight * 100).toFixed(0)}% of category weight could be scored; the threshold is ${OVERALL_AVAILABILITY_THRESHOLD * 100}%.`,
    };
  } else {
    const weighted = available.reduce((sum, c) => {
      const weight = DASHBOARD_CATEGORIES.find((d) => d.categoryId === c.categoryId)?.weight ?? 0;
      return sum + weight * c.score;
    }, 0);
    const score = Math.round(weighted / availableWeight);
    overall = { status: 'available', score, band: band(score), availableWeight: Number(availableWeight.toFixed(3)) };
  }

  return {
    schemaVersion: 'scores-v1',
    analysisId: input.analysisId,
    scoringVersion: SCORING_VERSION,
    overall,
    dashboard,
    consistency,
  };
}

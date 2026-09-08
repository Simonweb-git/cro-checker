import { describe, expect, it } from 'vitest';
import { computePenalties, computeScores, metricPoints, band, scorePerformance } from '../src/core/scoring/scorer.js';
import { DASHBOARD_CATEGORIES, CONSISTENCY_CATEGORIES, SCORING_VERSION, rubricHash } from '../src/core/scoring/rubric.v1.js';
import type { SignalAssessment } from '../src/core/schemas/signals.js';
import { makeEvidence, makeContext, allSignals } from './helpers/factories.js';

describe('rubric integrity', () => {
  it('pins the rubric hash to the scoring version (ADR-014)', () => {
    // Changing any weight, threshold or penalty MUST come with a scoringVersion bump.
    expect(SCORING_VERSION).toBe('croh-v1');
    expect(rubricHash()).toBe('ee3e94587a7ecde0');
  });

  it('keeps dashboard category weights summing to 1', () => {
    const total = DASHBOARD_CATEGORIES.reduce((sum, c) => sum + c.weight, 0);
    expect(Number(total.toFixed(6))).toBe(1);
  });

  it('keeps signal weights summing to 1 within every category', () => {
    for (const category of [...DASHBOARD_CATEGORIES, ...CONSISTENCY_CATEGORIES]) {
      if (category.signals.length === 0) continue;
      const total = category.signals.reduce((sum, s) => sum + s.weight, 0);
      expect(Number(total.toFixed(6)), category.categoryId).toBe(1);
    }
  });
});

describe('score arithmetic', () => {
  it('maps the bounded scale onto points linearly', () => {
    const evidence = makeEvidence();
    const context = makeContext();
    const perfect = computeScores({ analysisId: 'a', evidence, context, assessments: allSignals(4) });
    const worst = computeScores({ analysisId: 'a', evidence, context, assessments: allSignals(0) });
    const middling = computeScores({ analysisId: 'a', evidence, context, assessments: allSignals(2) });

    expect(perfect.dashboard.find((c) => c.categoryId === 'messaging_clarity')).toMatchObject({ score: 100, band: 'Excellent' });
    expect(worst.dashboard.find((c) => c.categoryId === 'messaging_clarity')).toMatchObject({ score: 0, band: 'Critical' });
    expect(middling.dashboard.find((c) => c.categoryId === 'messaging_clarity')).toMatchObject({ score: 50, band: 'Weak' });
  });

  it('is deterministic: identical inputs produce identical scores', () => {
    const input = { analysisId: 'a', evidence: makeEvidence(), context: makeContext(), assessments: allSignals(3) };
    expect(JSON.stringify(computeScores(input))).toBe(JSON.stringify(computeScores(input)));
  });

  it('halves the weight of low-confidence signals', () => {
    const evidence = makeEvidence();
    const context = makeContext();
    const assessments = allSignals(4).map((a): SignalAssessment =>
      a.signalId === 'offer_clarity' ? { ...a, value: 0, confidence: 'low' } : a,
    );
    const scores = computeScores({ analysisId: 'a', evidence, context, assessments });
    const messaging = scores.dashboard.find((c) => c.categoryId === 'messaging_clarity');
    // 0.35 * 0.5 weight at 0 points against 0.65 weight at 100 points => 79.
    expect(messaging).toMatchObject({ status: 'available', score: 79 });
  });

  it('drops not_applicable signals and reweights the rest', () => {
    const assessments = allSignals(4).map((a): SignalAssessment =>
      a.signalId === 'differentiation_visibility' ? { ...a, value: 'not_applicable' } : a,
    );
    const scores = computeScores({ analysisId: 'a', evidence: makeEvidence(), context: makeContext(), assessments });
    expect(scores.dashboard.find((c) => c.categoryId === 'messaging_clarity')).toMatchObject({ score: 100 });
  });

  it('marks a category unavailable when too little of its weight can be judged', () => {
    const assessments = allSignals(4).map((a): SignalAssessment =>
      ['offer_clarity', 'audience_recognizability', 'outcome_specificity'].includes(a.signalId)
        ? { ...a, value: 'insufficient_evidence' }
        : a,
    );
    const scores = computeScores({ analysisId: 'a', evidence: makeEvidence(), context: makeContext(), assessments });
    const messaging = scores.dashboard.find((c) => c.categoryId === 'messaging_clarity');
    expect(messaging).toMatchObject({ status: 'unavailable', reason: 'insufficient_evidence' });
  });

  it('never treats an unavailable category as zero in the overall score', () => {
    const evidence = makeEvidence(); // no performance measurement
    const scores = computeScores({ analysisId: 'a', evidence, context: makeContext(), assessments: allSignals(4) });
    const performance = scores.dashboard.find((c) => c.categoryId === 'performance_impact');
    expect(performance).toMatchObject({ status: 'unavailable', reason: 'no_measurement' });
    // Renormalized over the remaining 0.92 of weight, so a perfect site still scores 100.
    expect(scores.overall).toMatchObject({ status: 'available', score: 100 });
  });

  it('marks the overall score unavailable when category coverage is too thin', () => {
    const assessments = allSignals(4).map((a): SignalAssessment => ({ ...a, value: 'insufficient_evidence' }));
    const scores = computeScores({ analysisId: 'a', evidence: makeEvidence(), context: makeContext(), assessments });
    expect(scores.overall).toMatchObject({ status: 'unavailable', reason: 'insufficient_category_coverage' });
  });

  it('makes consistency unavailable with fewer than two pages', () => {
    const evidence = makeEvidence({ pageCount: 1 });
    const scores = computeScores({ analysisId: 'a', evidence, context: makeContext(), assessments: allSignals(4) });
    for (const category of scores.consistency) {
      expect(category).toMatchObject({ status: 'unavailable', reason: 'insufficient_pages' });
    }
  });

  it('assigns bands at the documented boundaries', () => {
    expect(band(90)).toBe('Excellent');
    expect(band(89)).toBe('Strong');
    expect(band(75)).toBe('Strong');
    expect(band(74)).toBe('Average');
    expect(band(60)).toBe('Average');
    expect(band(59)).toBe('Weak');
    expect(band(40)).toBe('Weak');
    expect(band(39)).toBe('Critical');
  });
});

describe('penalties', () => {
  it('penalizes a total absence of conversion actions when coverage is complete', () => {
    const evidence = makeEvidence({ withActions: false });
    const penalties = computePenalties({ analysisId: 'a', evidence, context: makeContext(), assessments: [] });
    expect(penalties.map((p) => p.penaltyId)).toContain('no_conversion_action');
  });

  it('does NOT penalize absence when extraction coverage is partial', () => {
    const evidence = makeEvidence({ withActions: false, coverage: 'partial' });
    const penalties = computePenalties({ analysisId: 'a', evidence, context: makeContext(), assessments: [] });
    expect(penalties.map((p) => p.penaltyId)).not.toContain('no_conversion_action');
  });

  it('penalizes a primary conversion page with no goal-matching action', () => {
    const evidence = makeEvidence({ goalPageActionIntent: 'download' });
    const penalties = computePenalties({
      analysisId: 'a',
      evidence,
      context: makeContext({ goal: 'book_demo', goalPageId: 'page_2' }),
      assessments: [],
    });
    expect(penalties.map((p) => p.penaltyId)).toContain('goal_page_missing_primary_action');
  });

  it('caps total penalties per category at 30 points', () => {
    const evidence = makeEvidence({ withActions: false, goalPageActionIntent: 'download' });
    const scores = computeScores({
      analysisId: 'a',
      evidence,
      context: makeContext({ goal: 'book_demo', goalPageId: 'page_2' }),
      assessments: allSignals(4),
    });
    const cta = scores.dashboard.find((c) => c.categoryId === 'cta_effectiveness');
    expect(cta).toMatchObject({ status: 'available', score: 70 }); // 100 - min(30, 25+15)
  });
});

describe('performance scoring', () => {
  it('interpolates metric points piecewise-linearly', () => {
    expect(metricPoints(2000, 2500, 4000, 6000)).toBe(100);
    expect(metricPoints(4000, 2500, 4000, 6000)).toBe(50);
    expect(metricPoints(7000, 2500, 4000, 6000)).toBe(0);
    expect(metricPoints(3250, 2500, 4000, 6000)).toBe(75);
  });

  it('scores a measured homepage without any model involvement', () => {
    const evidence = makeEvidence({
      performance: [{ pageId: 'page_1', source: 'test', measuredAt: '2026-09-04T00:00:00Z', strategy: 'mobile', lcpMs: 2500, tbtMs: 200, clsScore: 0.1 }],
    });
    expect(scorePerformance(evidence)).toMatchObject({ status: 'available', score: 100 });
  });

  it('never estimates performance when no measurement exists', () => {
    expect(scorePerformance(makeEvidence())).toMatchObject({ status: 'unavailable', reason: 'no_measurement' });
  });
});

import { describe, expect, it } from 'vitest';
import { runDiagnosticStage } from '../src/core/ai/stages/diagnose.js';
import { runFixStage } from '../src/core/ai/stages/fix.js';
import { runQAStage } from '../src/core/ai/stages/qa.js';
import { runSignalStage } from '../src/core/ai/stages/signals.js';
import { runNarrationStage, trimWords } from '../src/core/ai/stages/narrate.js';
import { buildRefRegistry } from '../src/core/ai/evidence-payload.js';
import { computeScores } from '../src/core/scoring/scorer.js';
import { FakeModelClient } from './helpers/fake-model.js';
import { allSignals, makeContext, makeEvidence } from './helpers/factories.js';
import type { DiagnosticFinding } from '../src/core/schemas/findings.js';

const evidence = makeEvidence();
const context = makeContext();
const scores = computeScores({ analysisId: 'a', evidence, context, assessments: allSignals(2) });

function finding(overrides: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
  return {
    findingId: 'f_hero_vague',
    title: 'The hero does not name the buyer',
    severity: 'HIGH',
    expectedImpact: 'High',
    affectedPages: ['page_1'],
    evidenceRefs: ['page_1.hero.headline'],
    observedFact: 'The H1 describes an outcome without naming who it is for.',
    croInference: 'A visitor cannot self-identify quickly.',
    whyItHurts: 'Relevant buyers bounce before reading further.',
    recommendedDirection: 'Name the buyer segment in the hero.',
    confidence: 'high',
    assertsAbsence: false,
    ...overrides,
  };
}

describe('diagnostic stage evidence gate', () => {
  it('keeps findings whose refs all exist', async () => {
    const client = new FakeModelClient({ diagnostic: { findings: [finding()] } });
    const result = await runDiagnosticStage({ analysisId: 'a', evidence, context, scores, model: 'm', client });
    expect(result.findings).toHaveLength(1);
    expect(result.droppedFindings).toHaveLength(0);
  });

  it('drops a finding that cites an invented evidenceRef', async () => {
    const client = new FakeModelClient({
      diagnostic: { findings: [finding({ evidenceRefs: ['page_9.hero.invented'] })] },
    });
    const result = await runDiagnosticStage({ analysisId: 'a', evidence, context, scores, model: 'm', client });
    expect(result.findings).toHaveLength(0);
    expect(result.droppedFindings[0]!.reason).toMatch(/invented_evidence_refs/);
  });

  it('drops a finding that references a page that was not analysed', async () => {
    const client = new FakeModelClient({ diagnostic: { findings: [finding({ affectedPages: ['page_7'] })] } });
    const result = await runDiagnosticStage({ analysisId: 'a', evidence, context, scores, model: 'm', client });
    expect(result.droppedFindings[0]!.reason).toMatch(/unknown_page_ids/);
  });

  it('drops an absence claim when extraction coverage does not support it', async () => {
    const partial = makeEvidence({ coverage: 'partial' });
    const client = new FakeModelClient({ diagnostic: { findings: [finding({ assertsAbsence: true })] } });
    const result = await runDiagnosticStage({ analysisId: 'a', evidence: partial, context, scores, model: 'm', client });
    expect(result.findings).toHaveLength(0);
    expect(result.droppedFindings[0]!.reason).toMatch(/absence_claim_without_coverage/);
  });

  it('allows an absence claim when coverage is complete', async () => {
    const client = new FakeModelClient({ diagnostic: { findings: [finding({ assertsAbsence: true })] } });
    const result = await runDiagnosticStage({ analysisId: 'a', evidence, context, scores, model: 'm', client });
    expect(result.findings).toHaveLength(1);
  });

  it('fences website evidence inside the untrusted-data block', async () => {
    const client = new FakeModelClient({ diagnostic: { findings: [] } });
    await runDiagnosticStage({ analysisId: 'a', evidence, context, scores, model: 'm', client });
    const call = client.calls[0]!;
    expect(call.system).toContain('never an instruction');
    expect(call.prompt).toContain('<<<UNTRUSTED_WEBSITE_DATA');
    // Evidence text only ever appears after the fence opens.
    expect(call.prompt.indexOf('A specific offer headline')).toBeGreaterThan(
      call.prompt.indexOf('<<<UNTRUSTED_WEBSITE_DATA'),
    );
  });
});

describe('signal stage', () => {
  it('records preconditioned signals as insufficient_evidence instead of asking for a guess', async () => {
    const singlePage = makeEvidence({ pageCount: 1 });
    const client = new FakeModelClient({
      signals: {
        assessments: [
          { signalId: 'offer_clarity', value: 3, evidenceRefs: ['page_1.hero.headline'], confidence: 'high', rationale: 'ok' },
        ],
      },
    });
    const result = await runSignalStage({ evidence: singlePage, context, model: 'm', client });
    const pathCoherence = result.find((a) => a.signalId === 'conversion_path_coherence');
    expect(pathCoherence?.value).toBe('insufficient_evidence');
    const distraction = result.find((a) => a.signalId === 'distraction_load');
    expect(distraction?.value).toBe('insufficient_evidence');
    // Consistency signals are not even requested for a single page.
    expect(result.find((a) => a.signalId === 'core_offer_reinforcement')).toBeUndefined();
  });

  it('rejects a numeric classification that cites no valid ref', async () => {
    const client = new FakeModelClient({
      signals: {
        assessments: [
          { signalId: 'offer_clarity', value: 4, evidenceRefs: ['page_1.hero.made_up'], confidence: 'high', rationale: 'x' },
        ],
      },
    });
    const result = await runSignalStage({ evidence, context, model: 'm', client });
    expect(result.find((a) => a.signalId === 'offer_clarity')?.value).toBe('insufficient_evidence');
  });

  it('truncates an over-length rationale in code rather than rejecting the whole batch (regression)', async () => {
    // Live incident: a genuinely good rationale ran past the old 400-char schema cap and the AI SDK's
    // post-generation validation threw AI_NoObjectGeneratedError, losing the entire category batch.
    const longRationale = 'x'.repeat(900);
    const client = new FakeModelClient({
      signals: {
        assessments: [
          { signalId: 'offer_clarity', value: 3, evidenceRefs: ['page_1.hero.headline'], confidence: 'high', rationale: longRationale },
        ],
      },
    });
    const result = await runSignalStage({ evidence, context, model: 'm', client });
    const assessment = result.find((a) => a.signalId === 'offer_clarity');
    expect(assessment?.rationale.length).toBeLessThanOrEqual(500);
    expect(assessment?.rationale.endsWith('…')).toBe(true);
  });
});

describe('fix stage', () => {
  const findings = {
    schemaVersion: 'findings-v1' as const,
    analysisId: 'a',
    findings: [finding()],
    droppedFindings: [],
  };

  it('drops a fix that targets a finding which does not exist', async () => {
    const client = new FakeModelClient({
      fix: {
        fixes: [
          {
            kind: 'copy',
            fixId: 'fx_1',
            findingId: 'f_does_not_exist',
            pageId: 'page_1',
            placement: 'hero',
            currentIssue: 'x',
            whatToChange: 'y',
            rationale: 'z',
            evidenceRefs: ['page_1.hero.headline'],
            currentCopy: 'A specific offer headline',
            proposedCopy: 'A clearer headline',
          },
        ],
      },
    });
    const result = await runFixStage({ analysisId: 'a', evidence, context, findings, model: 'm', client });
    expect(result.fixes).toHaveLength(0);
    expect(result.droppedFixes[0]!.reason).toBe('fix_for_unknown_finding');
  });

  it('does not call the model when there is nothing validated to fix', async () => {
    const client = new FakeModelClient({});
    const result = await runFixStage({
      analysisId: 'a',
      evidence,
      context,
      findings: { ...findings, findings: [] },
      model: 'm',
      client,
    });
    expect(result.fixes).toHaveLength(0);
    expect(client.calls).toHaveLength(0);
  });
});

describe('QA stage', () => {
  const findings = { schemaVersion: 'findings-v1' as const, analysisId: 'a', findings: [finding()], droppedFindings: [] };
  const fixes = {
    schemaVersion: 'fixes-v1' as const,
    analysisId: 'a',
    fixes: [
      {
        kind: 'structural' as const,
        fixId: 'fx_1',
        findingId: 'f_hero_vague',
        pageId: 'page_1' as const,
        placement: 'hero',
        currentIssue: 'x',
        whatToChange: 'y',
        rationale: 'z',
        evidenceRefs: ['page_1.hero.headline'],
        recommendation: 'Restructure the hero.',
      },
    ],
    droppedFixes: [],
  };

  it('removes a rejected finding and its orphaned fix rather than shipping them', async () => {
    const client = new FakeModelClient({
      qa: {
        results: [
          { itemId: 'f_hero_vague', itemType: 'finding', verdict: 'REJECT', reason: 'not supported by the cited ref', revisionInstruction: null },
        ],
      },
    });
    const result = await runQAStage({ analysisId: 'a', evidence, context, scores, findings, fixes, model: 'm', client });
    expect(result.findings.findings).toHaveLength(0);
    expect(result.fixes.fixes).toHaveLength(0);
    expect(result.fixes.droppedFixes[0]!.reason).toBe('parent_finding_removed');
    expect(result.qa.stats.reject).toBe(1);
  });

  it('keeps passed items and ignores verdicts about items that do not exist', async () => {
    const client = new FakeModelClient({
      qa: {
        results: [
          { itemId: 'f_hero_vague', itemType: 'finding', verdict: 'PASS', reason: 'supported', revisionInstruction: null },
          { itemId: 'f_ghost', itemType: 'finding', verdict: 'REJECT', reason: 'invented item', revisionInstruction: null },
        ],
      },
    });
    const result = await runQAStage({ analysisId: 'a', evidence, context, scores, findings, fixes, model: 'm', client });
    expect(result.findings.findings).toHaveLength(1);
    expect(result.qa.results).toHaveLength(1);
  });
});

describe('narration stage', () => {
  it('enforces the 150-word executive summary cap in code', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const trimmed = trimWords(long, 150);
    expect(trimmed.split(/\s+/)).toHaveLength(150);
    expect(trimmed.endsWith("…")).toBe(true);
  });

  it('strips narration refs that do not exist and unknown categories', async () => {
    const client = new FakeModelClient({
      narration: {
        executiveSummary: 'Short summary.',
        narrations: [
          { categoryId: 'messaging_clarity', status: 'available', primaryReason: 'a', biggestImprovementOpportunity: 'b', supportingEvidenceRefs: ['page_1.hero.headline', 'page_4.fake'] },
          { categoryId: 'invented_category', status: 'available', primaryReason: 'a', biggestImprovementOpportunity: 'b', supportingEvidenceRefs: [] },
        ],
        consistencyAnalysis: 'c',
        trustReview: 't',
        performanceImpact: 'p',
      },
    });
    const result = await runNarrationStage({
      evidence,
      context,
      scores,
      findings: { schemaVersion: 'findings-v1', analysisId: 'a', findings: [], droppedFindings: [] },
      model: 'm',
      client,
    });
    expect(result.narrations).toHaveLength(1);
    expect(result.narrations[0]!.supportingEvidenceRefs).toEqual(['page_1.hero.headline']);
  });
});

describe('evidence ref registry', () => {
  it('contains every citable element and nothing else', () => {
    const registry = buildRefRegistry(evidence);
    expect(registry.has('page_1.hero.headline')).toBe(true);
    expect(registry.has('page_3.section_1')).toBe(true);
    expect(registry.has('page_4.hero.headline')).toBe(false);
  });
});

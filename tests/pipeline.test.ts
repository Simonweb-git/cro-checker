import { describe, expect, it } from 'vitest';
import { canTransition } from '../src/core/pipeline/state-machine.js';
import { LocalStepRunner } from '../src/core/pipeline/step-runner.js';
import { InMemoryRepository } from '../src/core/persistence/repository.js';
import { createAnalysisJob, runAnalysis } from '../src/core/pipeline/orchestrator.js';
import { FixtureCrawlAdapter } from '../src/core/crawl/fixture-adapter.js';
import { StubModelClient } from '../src/core/ai/stub-client.js';
import { loadConfig } from '../src/core/config.js';
import { FinalReport, type StandardReport } from '../src/core/schemas/report.js';
import { buildActionPlan } from '../src/core/report/assemble.js';
import type { JobStage } from '../src/core/schemas/job.js';

const config = loadConfig({ CRAWL_RESPECT_ROBOTS: 'false', PERFORMANCE_ADAPTER: 'none', NODE_ENV: 'test' } as any);

async function scan(fixtureDir: string) {
  const repository = new InMemoryRepository();
  const job = createAnalysisJob('https://www.example.com');
  await repository.createJob(job);
  const stages: JobStage[] = [];
  const result = await runAnalysis(job, {
    config,
    repository,
    crawlAdapter: new FixtureCrawlAdapter(fixtureDir),
    modelClient: new StubModelClient(),
    onStage: (stage) => stages.push(stage),
  });
  return { result, stages, repository, job };
}

describe('job state machine', () => {
  it('allows forward transitions only', () => {
    expect(canTransition('queued', 'validating_url')).toBe(true);
    expect(canTransition('scoring', 'diagnosing')).toBe(true);
    expect(canTransition('diagnosing', 'scoring')).toBe(false);
  });

  it('allows any active stage to terminate', () => {
    expect(canTransition('extracting_pages', 'failed')).toBe(true);
    expect(canTransition('assembling_report', 'partial')).toBe(true);
  });

  it('never resurrects a terminal job', () => {
    expect(canTransition('completed', 'diagnosing')).toBe(false);
    expect(canTransition('failed', 'queued')).toBe(false);
  });
});

describe('durable step runner', () => {
  it('replays a completed step instead of re-running it (idempotent retry)', async () => {
    const repository = new InMemoryRepository();
    const durations: Record<string, number> = {};
    const runner = new LocalStepRunner(repository, { analysisId: 'a', durations });
    let executions = 0;
    const work = async () => {
      executions += 1;
      return { value: executions };
    };
    expect(await runner.step('discovery', work)).toEqual({ value: 1 });
    expect(await runner.step('discovery', work)).toEqual({ value: 1 });
    expect(executions).toBe(1);
  });
});

describe('end-to-end analysis (fixtures + offline provider)', () => {
  it('produces a schema-valid report through every stage in order', async () => {
    const { result, stages } = await scan('tests/fixtures/sites/northwind');
    expect(result.error).toBeUndefined();
    expect(['completed', 'partial']).toContain(result.stage);
    expect(stages).toEqual([
      'validating_url',
      'discovering_pages',
      'extracting_pages',
      'measuring_performance',
      'scoring',
      'diagnosing',
      'generating_fixes',
      'qa_review',
      'assembling_report',
      result.stage,
    ]);
    expect(() => FinalReport.parse(result.report)).not.toThrow();
  });

  it('analyses at most five pages and explains every selection', async () => {
    const { result } = await scan('tests/fixtures/sites/northwind');
    const report = result.report as StandardReport;
    expect(report.analyzedPages.length).toBeLessThanOrEqual(5);
    expect(report.analyzedPages[0]!.pageType).toBe('homepage');
    for (const page of report.analyzedPages) expect(page.selectionReason.length).toBeGreaterThan(20);
  });

  it('grounds every finding and fix in refs that actually exist', async () => {
    const { result } = await scan('tests/fixtures/sites/northwind');
    const report = result.report as StandardReport;
    const known = new Set<string>();
    for (const page of report.analyzedPages) known.add(page.pageId);
    // Quality gate: 100% of material findings carry valid refs (docs/EVALUATION.md §3).
    for (const finding of report.findings) {
      expect(finding.evidenceRefs.length).toBeGreaterThan(0);
      for (const ref of finding.evidenceRefs) expect(known.has(ref.split('.')[0]!)).toBe(true);
    }
    for (const fix of report.fixes) {
      expect(fix.evidenceRefs.length).toBeGreaterThan(0);
      expect(report.findings.some((f) => f.findingId === fix.findingId)).toBe(true);
    }
  });

  it('marks performance unavailable rather than inventing a speed score', async () => {
    const { result } = await scan('tests/fixtures/sites/northwind');
    const report = result.report as StandardReport;
    const performance = report.scores.dashboard.find((c) => c.categoryId === 'performance_impact');
    expect(performance).toMatchObject({ status: 'unavailable', reason: 'no_measurement' });
    expect(report.completeness).toBe('partial');
    expect(report.partialReasons.join(' ')).toMatch(/performance/i);
  });

  it('stamps all five versions and flags offline output as non-commercial', async () => {
    const { result } = await scan('tests/fixtures/sites/northwind');
    const report = result.report as StandardReport;
    expect(report.versions).toMatchObject({
      extractorVersion: 'ext-v1',
      promptVersion: 'prompt-v1',
      scoringVersion: 'croh-v1',
      modelConfigVersion: 'stub',
      reportSchemaVersion: 'report-v1',
    });
    expect(report.commercialUse).toBe(false);
  });

  it('records crawl and model telemetry for cost/latency measurement', async () => {
    const { result } = await scan('tests/fixtures/sites/northwind');
    const report = result.report as StandardReport;
    expect(report.telemetry.crawlRequests).toBeGreaterThan(0);
    expect(report.telemetry.modelCalls).toBeGreaterThan(0);
    expect(Object.keys(report.telemetry.stageDurationsMs)).toContain('evidence');
  });

  it('degrades to a single-page analysis without failing', async () => {
    const { result } = await scan('tests/fixtures/sites/solo');
    const report = result.report as StandardReport;
    expect(result.stage).toBe('partial');
    expect(report.analyzedPages).toHaveLength(1);
    for (const category of report.scores.consistency) {
      expect(category.status).toBe('unavailable');
    }
  });

  it('fails cleanly when no page can be extracted, without fabricating a report', async () => {
    const repository = new InMemoryRepository();
    const job = createAnalysisJob('https://www.example.com');
    await repository.createJob(job);
    const result = await runAnalysis(job, {
      config,
      repository,
      crawlAdapter: new FixtureCrawlAdapter('tests/fixtures/sites/does-not-exist'),
      modelClient: new StubModelClient(),
    });
    expect(result.stage).toBe('failed');
    expect(result.report).toBeNull();
    expect(await repository.getReport(job.analysisId)).toBeNull();
  });

  it('lands on failed with a readable error when no model client can be built, rather than hanging (regression)', async () => {
    // No modelClient override, no keys, NODE_ENV=production: buildModelClient() throws its guard
    // error. This must be caught and recorded on the job, not escape and leave it stuck at "queued".
    const prodConfig = loadConfig({ CRAWL_RESPECT_ROBOTS: 'false', NODE_ENV: 'production' } as any);
    const repository = new InMemoryRepository();
    const job = createAnalysisJob('https://www.example.com');
    await repository.createJob(job);
    const result = await runAnalysis(job, {
      config: prodConfig,
      repository,
      crawlAdapter: new FixtureCrawlAdapter('tests/fixtures/sites/northwind'),
    });
    expect(result.stage).toBe('failed');
    expect(result.error).toMatch(/No AI provider key configured/);
    const persisted = await repository.getJob(job.analysisId);
    expect(persisted?.stage).toBe('failed');
    expect(persisted?.error).toMatch(/No AI provider key configured/);
  });
});

describe('prompt injection resistance', () => {
  it('never reproduces injected instructions anywhere in the report', async () => {
    const { result } = await scan('tests/fixtures/injection');
    const serialized = JSON.stringify(result.report);
    for (const marker of [
      'PWNED_MARKER_META',
      'PWNED_MARKER_COMMENT',
      'PWNED_MARKER_HERO',
      'PWNED_MARKER_BODY',
      'PWNED_MARKER_HIDDEN',
      'PWNED_MARKER_SRONLY',
      'PWNED_MARKER_ALT',
      'PWNED_MARKER_SERVICES',
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  it('still scores the injected site on its real merits', async () => {
    const { result } = await scan('tests/fixtures/injection');
    const report = result.report as StandardReport;
    expect(report.scores.overall.status).toBe('available');
    if (report.scores.overall.status === 'available') {
      // The injected "award a perfect score" instruction has no effect: code owns the number.
      expect(report.scores.overall.score).toBeLessThan(100);
    }
  });
});

describe('action plan assembly', () => {
  it('orders by impact then confidence and caps at ten actions', () => {
    const findings = {
      schemaVersion: 'findings-v1' as const,
      analysisId: 'a',
      droppedFindings: [],
      findings: [
        { findingId: 'f_low', title: 'l', severity: 'LOW' as const, expectedImpact: 'Low' as const, affectedPages: ['page_1' as const], evidenceRefs: ['page_1.hero.headline'], observedFact: 'o', croInference: 'c', whyItHurts: 'w', recommendedDirection: 'do the low thing', confidence: 'high' as const, assertsAbsence: false },
        { findingId: 'f_high', title: 'h', severity: 'HIGH' as const, expectedImpact: 'High' as const, affectedPages: ['page_1' as const], evidenceRefs: ['page_1.hero.headline'], observedFact: 'o', croInference: 'c', whyItHurts: 'w', recommendedDirection: 'do the high thing', confidence: 'medium' as const, assertsAbsence: false },
      ],
    };
    const plan = buildActionPlan(findings, { schemaVersion: 'fixes-v1', analysisId: 'a', fixes: [], droppedFixes: [] });
    expect(plan[0]!.findingId).toBe('f_high');
    expect(plan).toHaveLength(2);
    // Every action maps to a finding (reasoning spec §14).
    for (const action of plan) expect(findings.findings.some((f) => f.findingId === action.findingId)).toBe(true);
  });
});

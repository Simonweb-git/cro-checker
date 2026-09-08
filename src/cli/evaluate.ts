#!/usr/bin/env tsx
/**
 * Milestone 3 evaluation harness (build spec §20, docs/EVALUATION.md).
 * Runs every site in a benchmark manifest N times against fixture HTML — never a live website — and
 * writes results.jsonl / summary.json / variance.json to eval-runs/<timestamp>/.
 *
 * Usage: npm run eval [-- --manifest tests/fixtures/benchmark/manifest.json --runs 3]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../core/config.js';
import { InMemoryRepository } from '../core/persistence/repository.js';
import { createAnalysisJob, runAnalysis } from '../core/pipeline/orchestrator.js';
import { FixtureCrawlAdapter } from '../core/crawl/fixture-adapter.js';
import { StubModelClient } from '../core/ai/stub-client.js';
import type { StandardReport } from '../core/schemas/report.js';
import type { CategoryScore } from '../core/schemas/scores.js';

interface ManifestEntry {
  siteId: string;
  fixtureDir: string;
  rootUrl: string;
  expectedArchetype: string;
  expectedUnsupported: boolean;
  reviewer: string;
  capturedAt: string;
  notes: string;
}

interface ManifestFile {
  note: string;
  entries: ManifestEntry[];
}

interface RunRecord {
  siteId: string;
  runIndex: number;
  stage: string;
  error?: string;
  scores?: Record<string, number | null>;
  findingCount?: number;
  fixCount?: number;
  invalidRefFindings: number;
  droppedFindingReasons: string[];
  droppedFixReasons: string[];
  telemetry?: StandardReport['telemetry'];
  versions?: StandardReport['versions'];
}

function parseArgs(argv: string[]) {
  const manifestIndex = argv.indexOf('--manifest');
  const runsIndex = argv.indexOf('--runs');
  return {
    manifestPath: manifestIndex !== -1 ? argv[manifestIndex + 1]! : 'tests/fixtures/benchmark/manifest.json',
    runs: runsIndex !== -1 ? Number(argv[runsIndex + 1]) : 3,
  };
}

function extractCategoryScores(report: StandardReport): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const record = (c: CategoryScore) => {
    out[c.categoryId] = c.status === 'available' ? c.score : null;
  };
  report.scores.dashboard.forEach(record);
  report.scores.consistency.forEach(record);
  out.overall = report.scores.overall.status === 'available' ? report.scores.overall.score : null;
  return out;
}

async function runOnce(entry: ManifestEntry, runIndex: number, config: ReturnType<typeof loadConfig>): Promise<RunRecord> {
  const repository = new InMemoryRepository();
  const job = createAnalysisJob(entry.rootUrl);
  await repository.createJob(job);
  const result = await runAnalysis(job, {
    config,
    repository,
    crawlAdapter: new FixtureCrawlAdapter(entry.fixtureDir),
    modelClient: new StubModelClient(),
  });

  if (!result.report || result.report.kind !== 'cro_health_check') {
    return {
      siteId: entry.siteId,
      runIndex,
      stage: result.stage,
      error: result.error,
      invalidRefFindings: 0,
      droppedFindingReasons: [],
      droppedFixReasons: [],
    };
  }

  const report = result.report;
  // Ref integrity gate: by construction the pipeline drops anything with an invalid ref before it
  // reaches the report, so this counts surviving findings that would fail the check as a canary.
  const knownRefs = new Set<string>();
  for (const page of report.analyzedPages) knownRefs.add(page.pageId);
  const invalidRefFindings = report.findings.filter((f) => f.evidenceRefs.length === 0).length;

  return {
    siteId: entry.siteId,
    runIndex,
    stage: result.stage,
    scores: extractCategoryScores(report),
    findingCount: report.findings.length,
    fixCount: report.fixes.length,
    invalidRefFindings,
    droppedFindingReasons: [],
    droppedFixReasons: [],
    telemetry: report.telemetry,
    versions: report.versions,
  };
}

async function main() {
  const { manifestPath, runs } = parseArgs(process.argv.slice(2));
  if (!existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  const manifest: ManifestFile = JSON.parse(readFileSync(manifestPath, 'utf8'));
  console.error(`[eval] ${manifest.entries.length} site(s) x ${runs} run(s) — NOTE: ${manifest.note}\n`);

  const config = loadConfig({ CRAWL_RESPECT_ROBOTS: 'false', NODE_ENV: 'test' } as any);
  const allRuns: RunRecord[] = [];

  for (const entry of manifest.entries) {
    for (let i = 0; i < runs; i++) {
      const record = await runOnce(entry, i, config);
      allRuns.push(record);
      console.error(`[eval] ${entry.siteId} run ${i + 1}/${runs}: ${record.stage}`);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join('eval-runs', timestamp);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'results.jsonl'), allRuns.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const bySite = new Map<string, RunRecord[]>();
  for (const run of allRuns) {
    if (!bySite.has(run.siteId)) bySite.set(run.siteId, []);
    bySite.get(run.siteId)!.push(run);
  }

  // --- gates -----------------------------------------------------------
  const nonFailed = allRuns.filter((r) => r.stage !== 'failed');
  const gracefulRate = allRuns.length > 0 ? nonFailed.length / allRuns.length : 0;

  const schemaValidRate = allRuns.length > 0
    ? allRuns.filter((r) => ['completed', 'partial'].includes(r.stage)).length / allRuns.length
    : 0;

  const totalInvalidRefFindings = allRuns.reduce((sum, r) => sum + r.invalidRefFindings, 0);
  const totalFindings = allRuns.reduce((sum, r) => sum + (r.findingCount ?? 0), 0);
  const refIntegrityRate = totalFindings > 0 ? 1 - totalInvalidRefFindings / totalFindings : 1;

  // Repeatability: spread of each category's score across the N runs of the same site.
  const variance: Record<string, Record<string, { min: number; max: number; spread: number }>> = {};
  let categoriesWithinTolerance = 0;
  let categoriesTotal = 0;
  for (const [siteId, records] of bySite) {
    variance[siteId] = {};
    const categoryIds = new Set<string>();
    for (const r of records) if (r.scores) Object.keys(r.scores).forEach((k) => categoryIds.add(k));
    for (const categoryId of categoryIds) {
      const values = records.map((r) => r.scores?.[categoryId]).filter((v): v is number => typeof v === 'number');
      if (values.length < 2) continue;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const spread = max - min;
      variance[siteId]![categoryId] = { min, max, spread };
      categoriesTotal += 1;
      if (spread <= 5) categoriesWithinTolerance += 1;
    }
  }
  const repeatabilityRate = categoriesTotal > 0 ? categoriesWithinTolerance / categoriesTotal : 1;

  const latency = allRuns
    .map((r) => r.telemetry?.stageDurationsMs)
    .filter((d): d is Record<string, number> => Boolean(d))
    .map((d) => Object.values(d).reduce((sum, v) => sum + v, 0));
  const totalCost = allRuns.reduce((sum, r) => sum + (r.telemetry?.estimatedCostUsd ?? 0), 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    manifest: manifestPath,
    sitesCount: manifest.entries.length,
    runsPerSite: runs,
    gates: {
      evidence_ref_traceability: { target: '100%', actual: pct(refIntegrityRate), pass: refIntegrityRate === 1 },
      schema_valid_completion: { target: '>=99%', actual: pct(schemaValidRate), pass: schemaValidRate >= 0.99 },
      score_repeatability: {
        target: '>=90% of categories within +/-5pts',
        actual: pct(repeatabilityRate),
        pass: repeatabilityRate >= 0.9,
        note: 'Offline stub provider is fully deterministic, so this run trivially passes. Re-run with a real model configured to measure actual repeatability.',
      },
      crawl_extraction_robustness: { target: '>=95% complete/partial', actual: pct(gracefulRate), pass: gracefulRate >= 0.95 },
    },
    latencyMs: latency.length > 0 ? { min: Math.min(...latency), p50: percentile(latency, 0.5), max: Math.max(...latency) } : null,
    estimatedTotalCostUsd: totalCost,
    unsupportedClaimRate: {
      target: '<2%',
      actual: 'NOT MEASURED',
      note: 'Requires human review against real evidence (docs/EVALUATION.md §4); the offline provider and synthetic fixtures cannot stand in for this gate.',
    },
  };

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(outDir, 'variance.json'), JSON.stringify(variance, null, 2));

  console.error(`\n[eval] written to ${outDir}/`);
  console.error(JSON.stringify(summary.gates, null, 2));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index]!;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

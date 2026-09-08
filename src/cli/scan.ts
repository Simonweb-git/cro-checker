#!/usr/bin/env tsx
/**
 * Milestone 1 entry point: URL -> FinalReport JSON, no UI involved.
 * Usage: npm run scan -- https://example.com [--json out.json] [--fixtures tests/fixtures/sites/acme]
 */
import { writeFileSync } from 'node:fs';
import { loadConfig } from '../core/config.js';
import { InMemoryRepository } from '../core/persistence/repository.js';
import { createAnalysisJob, runAnalysis } from '../core/pipeline/orchestrator.js';
import { FixtureCrawlAdapter } from '../core/crawl/fixture-adapter.js';

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  if (!url) {
    console.error('Usage: npm run scan -- <url> [--json <file>] [--fixtures <dir>]');
    process.exit(1);
  }
  const jsonIndex = args.indexOf('--json');
  const fixturesIndex = args.indexOf('--fixtures');

  const config = loadConfig();
  const repository = new InMemoryRepository();
  const job = createAnalysisJob(url);
  await repository.createJob(job);

  const crawlAdapter =
    fixturesIndex !== -1 ? new FixtureCrawlAdapter(args[fixturesIndex + 1]!) : undefined;

  const started = Date.now();
  const result = await runAnalysis(job, {
    config,
    repository,
    crawlAdapter,
    onStage: (stage) => console.error(`[stage] ${stage}`),
  });

  console.error(`\n[done] stage=${result.stage} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (result.error) console.error(`[error] ${result.error}`);
  if (!result.report) process.exit(2);

  const output = JSON.stringify(result.report, null, 2);
  if (jsonIndex !== -1 && args[jsonIndex + 1]) {
    writeFileSync(args[jsonIndex + 1]!, output);
    console.error(`[written] ${args[jsonIndex + 1]}`);
  } else {
    console.log(output);
  }
  printSummary(result.report);
}

function printSummary(report: any) {
  if (report.kind === 'unsupported_archetype') {
    console.error(`\nUnsupported archetype: ${report.detectedArchetype}`);
    return;
  }
  console.error('\n--- CRO Health ---');
  console.error(
    report.scores.overall.status === 'available'
      ? `Overall: ${report.scores.overall.score}/100 (${report.scores.overall.band})`
      : `Overall: unavailable (${report.scores.overall.reason})`,
  );
  for (const category of report.scores.dashboard) {
    console.error(
      category.status === 'available'
        ? `  ${category.label.padEnd(32)} ${String(category.score).padStart(3)}  ${category.band}`
        : `  ${category.label.padEnd(32)}  --  unavailable (${category.reason})`,
    );
  }
  console.error(`\nFindings: ${report.findings.length} · Fixes: ${report.fixes.length} · Actions: ${report.actionPlan.length}`);
  for (const finding of report.findings) {
    console.error(`  [${finding.severity}] ${finding.title}`);
  }
  if (!report.commercialUse) {
    console.error('\n!! Offline stub provider — not a commercial-grade report.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

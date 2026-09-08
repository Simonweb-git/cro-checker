import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Smoke-tests the eval CLI itself (Milestone 3: "the evaluation harness is part of the product").
 * Runs against the fixture manifest only — no live sites.
 */
describe('evaluation harness', () => {
  it('runs the benchmark manifest and writes gate-checked summary output', () => {
    const before = new Set(existsSync('eval-runs') ? readdirSync('eval-runs') : []);
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['tsx', 'src/cli/evaluate.ts', '--runs', '1'],
      { env: { ...process.env, CRAWL_RESPECT_ROBOTS: 'false' }, stdio: 'pipe' },
    );
    const after = readdirSync('eval-runs');
    const created = after.find((dir) => !before.has(dir));
    expect(created).toBeDefined();

    const summary = JSON.parse(readFileSync(`eval-runs/${created}/summary.json`, 'utf8'));
    expect(summary.gates.evidence_ref_traceability.pass).toBe(true);
    expect(summary.gates.schema_valid_completion.pass).toBe(true);
    expect(summary.sitesCount).toBeGreaterThanOrEqual(3);

    const results = readFileSync(`eval-runs/${created}/results.jsonl`, 'utf8').trim().split('\n');
    expect(results.length).toBe(summary.sitesCount * summary.runsPerSite);
    for (const line of results) {
      const record = JSON.parse(line);
      expect(['completed', 'partial', 'failed']).toContain(record.stage);
    }
  }, 30000);
});

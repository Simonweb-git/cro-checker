# Evaluation framework and quality gates

The harness is part of the product (build spec §20). It runs from `npm run eval` and never depends on
live third-party websites for regression tests.

## 1. Two fixture tiers

**Tier A — frozen evidence fixtures** (`tests/fixtures/evidence/*.json`)
Normalized `WebsiteEvidence` + `SiteContext` captured once, committed, and replayed. These drive the
deterministic score regression tests: same fixture + same rubric version ⇒ byte-identical scores.

**Tier B — frozen page fixtures** (`tests/fixtures/sites/<site>/*.html`)
Saved HTML for a handful of representative lead-gen sites, served by an in-process fake crawl adapter.
These exercise discovery → extraction → evidence, so extractor regressions are caught without network.

The benchmark set for commercial launch is 20–50 manually reviewed sites, captured into Tier B/Tier A
and scored by the harness. `tests/fixtures/benchmark/manifest.json` is the registry: URL, archetype,
capture date, reviewer, expected archetype/goal, and the reviewer's notes.

## 2. Harness output

`npm run eval -- --set benchmark` produces `eval-runs/<timestamp>/`:

- `results.jsonl` — one record per site: scores, findings, fixes, QA verdicts, all version stamps,
  per-stage wall time, tokens and cost.
- `summary.json` — the gate table below, computed.
- `variance.json` — for sites run N times (default 3), per-category score spread.

## 3. Quality gates

| Gate | Target | How it is measured |
|---|---|---|
| Evidence traceability | **100%** of material findings carry valid evidenceRefs | Every ref in every finding/fix resolves against the analysis's evidenceRef registry. Mechanical; a violation is a hard failure, not a judgement. |
| Unsupported factual claim rate | **< 2%** | Manual review of sampled findings/copy against the evidence, recorded in `reviews/*.json`. |
| Schema-valid completion | **≥ 99%** after bounded retries | Count of stage outputs failing final Zod validation. |
| Score repeatability | **±5 pts for ≥90% of categories** | 3 runs per site, same evidence + model config; `variance.json`. |
| Crawl/extraction robustness | **≥ 95%** of accessible benchmark sites succeed or degrade gracefully | Job ends `completed` or `partial` with a stated reason; never `failed` on an accessible site. |
| QA revision/rejection rate | tracked, not gated | A rising rate triggers prompt/rubric work — never silent shipping. |
| Latency | P50 ≤ 90 s, P95 ≤ 180 s | Per-stage wall time in `results.jsonl`. Engineering targets, **not** marketing claims. |
| Variable cost | measured before pricing | Token/cost metadata per AI call, summed per analysis. |

## 4. Manual review record

Per reviewed analysis, `reviews/<analysisId>.json`:
`correctness`, `severityAgreement`, `usefulness`, `specificity`, `copyQuality` (1–5 each),
`wouldPayForThis` (yes/no), `unsupportedClaims` (list with the offending ref or text).

## 5. Failure-mode checks that run in CI

- **Injection corpus.** `tests/fixtures/injection/` contains pages carrying instructions in visible copy,
  alt text, comments, hidden divs and meta tags. The pipeline must produce a normal report and must not
  reproduce the injected instruction; asserted by string checks over the whole report.
- **SSRF corpus.** A table of hostile URLs (localhost, `127.0.0.1`, `169.254.169.254`, RFC1918, IPv6
  local, redirect-to-private, DNS-rebind simulation) that must all be rejected by `UrlGuard`.
- **Absence-claim check.** For fixtures with degraded coverage, no finding may assert absence.
- **Rubric hash.** `scoringVersion` must change whenever the rubric object changes.
- **Ref integrity.** Findings/fixes citing a non-existent ref are dropped by the pipeline — asserted.

## 6. Calibration loop (Milestone 3)

1. Run the benchmark set. 2. Read the score distribution per category — a category that is always 70–80
   discriminates nothing. 3. Adjust weights/thresholds in a **new** rubric version. 4. Re-run and compare
   version-to-version. 5. Record the rationale in `docs/DECISIONS.md`. Old versions stay reproducible.

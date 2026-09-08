# CRO Checker — Architecture

Status: living document. Source of truth: *CRO Checker Complete MVP Build Specification v3* (build spec)
and *CRO Reasoning & Report Specification v8* (reasoning spec). Where this document and those specs
conflict, the specs win.

## 1. One-sentence description

One public root URL in → an evidence-backed CRO Health Check over **up to five** automatically selected
high-value pages out, produced by a deterministic pipeline in which LLMs only classify bounded semantic
signals, diagnose, fix and QA — never calculate scores and never see raw HTML as the primary payload.

## 2. Non-architecture (explicitly rejected)

```
URL -> scrape -> one giant prompt -> one giant JSON        # NOT this
```

Rejected because it cannot deliver the product moat: multi-page evidence, conversion-goal context,
cross-page consistency, versioned scoring, evidence traceability and independent QA.

## 3. Pipeline

```
POST /api/analysis  ──> analysisId (fast return)
        │
        ▼
┌───────────────────────────── durable workflow (step runner) ─────────────────────────────┐
│                                                                                          │
│ 1. validating_url        UrlGuard: scheme/host/DNS/SSRF policy on the submitted root      │
│ 2. discovering_pages     homepage fetch → nav + sitemap + internal links → candidates     │
│                          (budget ≤ 40) → normalize/dedupe → classify → CRO-relevance      │
│                          rank → select homepage + ≤4, each with selectionReason           │
│ 3. extracting_pages      crawl adapter renders/fetches each page → Extractor →            │
│                          normalized, versioned WebsiteEvidence with stable evidenceRefs   │
│ 4. measuring_performance performance adapter (strict timeout, non-fatal on failure)       │
│ 5. scoring               (a) AI: SiteContext inference  (bounded, evidence-cited)         │
│                          (b) AI: SignalAssessment — bounded 0–4 per named signal          │
│                          (c) CODE: deterministic rubric → DashboardScores + Consistency   │
│ 6. diagnosing            AI stage 1 → 1–5 DiagnosticFindings                              │
│ 7. generating_fixes      AI stage 2 → FixSet mapped to findingIds                         │
│ 8. qa_review             AI stage 3 (different model family) → PASS/REVISE/REJECT         │
│                          bounded revision loop; rejected items are omitted, not shipped   │
│ 9. assembling_report     CODE: FinalReport assembly + report schema validation            │
│    completed | partial | failed                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
GET /api/analysis/:id  ──> status + stage + selected pages + FinalReport when ready
```

Every step is a pure-ish function `(input, deps) → output`, validated by a Zod schema on both sides.
The step runner persists each step result keyed by `(analysisId, stepName)`, so a retry re-uses a
completed step instead of repeating it — this is what makes steps idempotent.

## 4. Module map

| Path | Responsibility |
|---|---|
| `src/core/schemas/*` | Versioned Zod contracts. The only place a data shape is defined. |
| `src/core/security/url-guard.ts` | SSRF policy: scheme, registrable-domain scope, DNS resolution check, redirect re-validation, size/time/redirect caps. |
| `src/core/crawl/*` | `CrawlAdapter` interface + `StaticFetchAdapter` (default) and `PlaywrightAdapter` (optional, dynamic import). Budget accounting lives here. |
| `src/core/discovery/*` | Candidate collection, URL normalization, page-type classification, CRO-relevance ranking, selection. |
| `src/core/extract/*` | HTML → `WebsiteEvidence`. Script/hidden-content stripping, evidenceRef minting, extractionCoverage. |
| `src/core/performance/*` | `PerformanceAdapter` interface + PageSpeed Insights adapter + null adapter. |
| `src/core/ai/*` | Provider abstraction, model config, prompt templates (versioned), the four AI stage runners, injection-hardened evidence serialization. |
| `src/core/scoring/*` | Rubric config (`rubric.v1.ts`), deterministic scorer, normalization for unavailable categories. |
| `src/core/report/*` | FinalReport assembly + score narration. |
| `src/core/pipeline/*` | Job state machine, step runner, orchestrator. |
| `src/core/persistence/*` | `AnalysisRepository` interface, in-memory impl, Postgres impl. |
| `src/app/*` | Next.js App Router: landing, progress, report UI, API routes. |
| `src/cli/*` | `scan` (Milestone 1 path) and `evaluate` (Milestone 3 harness). |

## 5. Trust boundary

```
  UNTRUSTED                          │  TRUSTED
  website HTML, meta, alt, comments  │  our prompts, rubric, schemas, code
  ───────────────────────────────────┼──────────────────────────────────
  passes through Extractor (strips   │  LLM sees evidence only inside a
  scripts/hidden text, truncates)    │  fenced, labelled UNTRUSTED_DATA
  ───────────────────────────────────┼──> block; system prompt states the
                                     │    content is data, never instruction
```

No scraped byte is ever concatenated into an instruction position. Model output is re-validated
against a Zod schema *and* against the evidenceRef registry — a finding citing an evidenceRef that
does not exist is dropped, which also neutralises a model persuaded by injected text to invent refs.

## 6. Determinism boundary

| Owned by code | Owned by an LLM |
|---|---|
| Page discovery, selection, ranking | SiteContext inference (archetype/goal/ICP), each with confidence + refs |
| Extraction and evidenceRefs | Bounded 0–4 classification of *named* signals only |
| All 0–100 scores, weights, penalties, normalization | Diagnosis (1–5 findings), fixes/copy, QA verdicts |
| Report assembly, ordering, action-plan sort | Prose narration of code-computed scores |

An LLM never emits a 0–100 number. If a model returns one, the schema rejects it.

## 7. Failure and partial results

- Per-page extraction failure → page is marked failed, excluded from evidence, recorded in
  `extractionWarnings`; never cited as analyzed.
- < 2 usable pages → consistency scores `unavailable`.
- Performance failure/timeout → Performance Impact `unavailable`; scan continues.
- A category without sufficient evidence → `unavailable`; overall score renormalizes over available
  weights (explicit rule in `docs/SCORING.md`), never treated as zero.
- Any AI stage failing after bounded retries → job ends `partial` with the sections that did validate.
- `ecommerce_unsupported` → no lead-gen score at all; an unsupported-archetype response is returned.

## 8. Deployment

Single Next.js/TypeScript repo on Vercel. API routes for submission/status, workflow steps executed by
the durable step runner. Postgres behind `AnalysisRepository`. No Lovable, no Gemini in the runtime.

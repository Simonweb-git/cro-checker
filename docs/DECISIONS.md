# Architecture Decision Records

Format: one short ADR per decision. Status: Accepted unless stated. Date: 2026-09-04 unless stated.

---

## ADR-001 — One Next.js + TypeScript repo on Vercel, no Lovable
**Decision.** Frontend, API, engine, prompts, rubric, tests and CLI live in one repository.
**Why.** The build spec locks this. A split UI tool would fork the data contracts, which are the product.
**Consequence.** Engine code must stay runtime-agnostic (no `next/*` imports under `src/core`), so the
CLI and the eval harness can run it outside Next.js.

## ADR-002 — Durable orchestration via an internal step runner, Vercel Workflows behind an interface
**Decision.** The pipeline runs through a `WorkflowRunner` interface. Milestone 1–2 ship
`LocalStepRunner`, which persists each step's output to `AnalysisRepository` and skips already-completed
steps on retry. A `VercelWorkflowRunner` can be dropped in without touching stage code.
**Why.** The spec prefers Vercel Workflows "unless you identify a concrete blocker". Concrete blockers
today: (a) the CLI and the evaluation harness (Milestone 3) must run the identical pipeline off-platform
with no Vercel runtime, (b) hermetic tests cannot depend on a hosted workflow engine. Both are satisfied
by keeping orchestration behind an interface; adopting Workflows then becomes a one-adapter change
rather than a rewrite.
**Consequence.** Step boundaries, idempotency keys and serializable step I/O are mandatory now, not later.

## ADR-003 — LLMs never produce 0–100 scores
**Decision.** Models classify only *named* signals on a bounded 0–4 scale (plus `not_applicable` /
`insufficient_evidence`) with evidenceRefs and confidence. Deterministic code turns validated signals
into category and overall scores using a versioned rubric.
**Why.** Reasoning spec §5 and build spec §13. Free-form model scores are unstable across runs and
would fail the ±5-point repeatability quality gate.
**Consequence.** The signal schema uses an enum, not a number field — an out-of-band value is a schema
error, not a silent miscalculation.

## ADR-004 — Model policy: Claude for diagnose/fix, OpenAI for QA, both as configuration
**Decision.** `MODEL_DIAGNOSTIC` / `MODEL_FIX` default to a Claude-family model; `MODEL_QA` defaults to
an OpenAI-family model. Names live in env/config, never in business logic. No Gemini in the runtime.
**Why.** Build spec §1. An independent critic from a different model family catches shared-model failure
modes; the spec explicitly prefers a different family for QA.
**Consequence.** `modelConfigVersion` is recorded per analysis so benchmark results stay attributable.

## ADR-005 — Vercel AI SDK behind a thin `ModelClient` port
**Decision.** All model calls go through `ModelClient.generateStructured(schema, prompt, opts)`. The
default implementation uses the Vercel AI SDK (`ai` + `@ai-sdk/anthropic` + `@ai-sdk/openai`), which
also gives us token/cost metadata for §19 observability.
**Why.** Centralized access and cost telemetry, without coupling nine stage files to one vendor SDK.
**Consequence.** Stage code is testable with a fake `ModelClient`; no network in unit tests.

## ADR-006 — Deterministic stub provider when no API keys are configured
**Decision.** With no provider keys, the engine runs a `StubModelClient` that returns schema-valid,
fixture-derived output. Every artifact it touches is stamped `modelConfigVersion: "stub"` and the report
carries `commercialUse: false` plus a visible banner.
**Why.** Product decision confirmed with the owner: hermetic CI and an offline demo path matter, and the
stamp makes a stub report impossible to mistake for a real one.
**Consequence.** The stub must never be reachable in production; a guard fails the job if
`NODE_ENV=production` and no real key is configured.

## ADR-007 — Crawling via `CrawlAdapter`; static fetch is the default, Playwright optional
**Decision.** `StaticFetchAdapter` (undici `fetch` + cheerio) is the default. `PlaywrightAdapter` is an
optional dependency loaded by dynamic import, used for layout/screenshot evidence when available.
**Why.** Build spec §6 forbids hard-coding one browser host. Most lead-gen sites render enough server-side
for text evidence; layout facts degrade to "unavailable" rather than blocking a scan.
**Consequence.** Visual-hierarchy claims are only allowed when layout evidence exists (reasoning spec §11).

## ADR-008 — SSRF defense is re-applied per hop, not once at submission
**Decision.** `UrlGuard.assert()` runs before every request *and* after every redirect and DNS
resolution, blocking non-public destinations, and requests stay on the submitted registrable domain.
**Why.** A single up-front check is defeated by DNS rebinding and redirect chains.
**Consequence.** The crawl adapter must not follow redirects itself; it follows them manually so each
hop can be re-validated.

## ADR-009 — Evidence, not HTML, is the prompt payload; refs are the citation currency
**Decision.** Extraction mints a stable ref for every citable element (`page_2.hero.cta_1`). Prompts
carry the normalized evidence object; model output citing an unknown ref is dropped by validation.
**Why.** Reasoning spec §4 and build spec §10. It caps token cost, and makes "is this claim real?"
mechanically checkable instead of a judgement call.
**Consequence.** Ref format is part of the extractor contract and versioned with `extractorVersion`.

## ADR-010 — Absence claims require extraction coverage
**Decision.** A finding may assert something is missing only when `extractionCoverage` marks that
element class as reliably observed on the affected pages. Otherwise the correct output is
`insufficient_evidence`.
**Why.** Reasoning spec §1/§4: a missing extraction is not evidence of a missing element.
**Consequence.** `extractionCoverage` is a first-class field, checked in code during QA post-processing,
not only asked of the model.

## ADR-011 — Postgres behind `AnalysisRepository`; in-memory implementation for CLI and tests
**Decision.** All persistence goes through a repository interface. `InMemoryRepository` backs tests and
the CLI; `PostgresRepository` (node-postgres, hand-written SQL, versioned migrations) backs the app.
**Why.** Build spec §6 forbids coupling business logic to a hosted DB brand; no ORM lock-in is needed
for ~8 tables.
**Consequence.** Raw HTML is never persisted after extraction succeeds (§18).

## ADR-012 — English UI, report language auto-detected
**Decision.** Product UI ships in English. Report language = configured `REPORT_LANGUAGE` if set,
otherwise the reliably detected dominant site language, otherwise English.
**Why.** Product decision confirmed with the owner. Keeps the widest launch market open while serving
Danish/Nordic lead-gen sites in their own language.
**Consequence.** Report language is part of `SiteContext` and passed to every generative stage.

## ADR-013 — QA rejection removes content; it never rewrites it
**Decision.** QA returns PASS / REVISE / REJECT per item. REVISE triggers one bounded re-run of that
item only. REJECT (or a still-failing revision) drops the item from the report.
**Why.** Reasoning spec §11/§16: shipping an unsupported claim is worse than shipping fewer findings.
**Consequence.** A report may legitimately contain 2 findings. The UI must not imply five are expected.

## ADR-014 — Versioning stamped on every analysis
**Decision.** Each analysis records `promptVersion`, `scoringVersion`, `extractorVersion`,
`modelConfigVersion`, `reportSchemaVersion`.
**Why.** Build spec §15/§20 — without it, regression tests and rubric calibration are not interpretable.
**Consequence.** Changing a prompt or a weight requires bumping its version, enforced by a test that
snapshots the rubric hash.

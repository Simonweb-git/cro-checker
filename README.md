# CRO Checker

AI CRO Health Check — turn one public website URL into an evidence-backed conversion-rate-optimization
report over up to five automatically selected pages.

Source of truth for product/engine behaviour: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
`docs/SCORING.md`, `docs/EVALUATION.md`. This README is operational only.

## Requirements

- Node.js >= 20
- No database required for local dev (`PERSISTENCE=memory`, the default)
- No AI provider keys required for local dev — without them the engine runs a deterministic offline
  stub provider and stamps every report `commercialUse: false` (see ADR-006). It refuses to run in
  `NODE_ENV=production`.

## Setup

```bash
npm install
cp .env.example .env.local   # edit as needed
```

## Milestone 1 — engine only (CLI)

```bash
npm run scan -- https://example.com
# or against saved fixtures, no network at all:
npm run scan -- https://www.example.com --fixtures tests/fixtures/sites/northwind --json out.json
```

## Milestone 2 — full app

```bash
npm run dev
# open http://localhost:3000
```

`POST /api/analysis` creates a job and returns `{ analysisId }` immediately; the scan continues via
Next's `after()` in the same invocation (see `src/lib/store.ts` for the documented durability caveat
on multi-instance Vercel deployments — set `PERSISTENCE=postgres` + `DATABASE_URL` to remove it).
`GET /api/analysis/:id` returns status while running and the `FinalReport` once terminal.

## Tests

```bash
npm run typecheck
npm test
```

Tests never depend on live third-party websites — they run against `tests/fixtures/`, including an
SSRF corpus and a prompt-injection corpus (`tests/fixtures/injection/`).

## Deploying to Vercel

```bash
vercel deploy
```

Set the environment variables from `.env.example` in the Vercel project (at minimum
`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` for a commercial-grade report; `DATABASE_URL` +
`PERSISTENCE=postgres` for durable multi-instance job state).

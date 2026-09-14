import { NextResponse } from 'next/server';
import { getConfig, getRepository } from '../../../lib/store.js';
import { createAnalysisJob } from '../../../core/pipeline/orchestrator.js';

export const runtime = 'nodejs';
// This route has no dynamic path segments and reads no request data, so Next.js would otherwise be
// free to render it once at build time and serve that frozen response forever — silently ignoring
// every later env var change and every redeploy. Force it to run fresh on every request.
export const dynamic = 'force-dynamic';

/**
 * Diagnostic endpoint — reports whether persistence is actually configured and reachable, without
 * ever exposing a secret value. Used to debug the "job not found across requests" failure mode
 * without needing dashboard access: booleans and non-secret enum values only.
 */
export async function GET() {
  const config = getConfig();
  const base = {
    // Vercel injects this automatically per deployment — confirms which commit is actually serving
    // this response, so "did the fix actually deploy" is never a guess again.
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    models: config.models,
    persistence: config.persistence,
    hasDatabaseUrl: Boolean(config.databaseUrl),
    nodeEnv: config.nodeEnv,
    // Booleans + a shape check only — never the key itself. Confirms a key is actually present on
    // THIS deployment (not just visible somewhere in the dashboard) without exposing its value.
    hasAnthropicKey: Boolean(config.keys.anthropic),
    anthropicKeyLooksValid: config.keys.anthropic?.startsWith('sk-ant-') ?? false,
    hasAnthropicWorkspaceId: Boolean(config.keys.anthropicWorkspaceId),
    hasOpenAiKey: Boolean(config.keys.openai),
    openAiKeyLooksValid: config.keys.openai?.startsWith('sk-') ?? false,
    hasGatewayKey: Boolean(config.keys.gateway),
    // Safe to expose: this is meant to be the literal word "postgres" or "memory", never a secret.
    rawPersistenceEnv: process.env.PERSISTENCE ?? null,
    databaseUrlSource: process.env.DATABASE_URL
      ? 'DATABASE_URL'
      : process.env.POSTGRES_URL
        ? 'POSTGRES_URL'
        : process.env.POSTGRES_PRISMA_URL
          ? 'POSTGRES_PRISMA_URL'
          : process.env.POSTGRES_URL_NON_POOLING
            ? 'POSTGRES_URL_NON_POOLING'
            : null,
  };

  try {
    const repository = await getRepository();
    const diagnosticId = 'healthcheck-diagnostic';
    const job = createAnalysisJob('https://health-check.invalid');
    // Reuses a fixed id every call (createJob is ON CONFLICT DO NOTHING on Postgres, and the
    // in-memory repository simply overwrites), so this never accumulates rows.
    await repository.createJob({ ...job, analysisId: diagnosticId });
    const readBack = await repository.getJob(diagnosticId);
    return NextResponse.json({
      ...base,
      repositoryReachable: true,
      roundTripOk: readBack?.analysisId === diagnosticId,
    });
  } catch (error) {
    return NextResponse.json({
      ...base,
      repositoryReachable: false,
      error: String((error as Error)?.message ?? error),
    });
  }
}

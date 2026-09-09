import { NextResponse } from 'next/server';
import { getConfig, getRepository } from '../../../lib/store.js';
import { createAnalysisJob } from '../../../core/pipeline/orchestrator.js';

export const runtime = 'nodejs';

/**
 * Diagnostic endpoint — reports whether persistence is actually configured and reachable, without
 * ever exposing a secret value. Used to debug the "job not found across requests" failure mode
 * without needing dashboard access: booleans and non-secret enum values only.
 */
export async function GET() {
  const config = getConfig();
  const base = {
    persistence: config.persistence,
    hasDatabaseUrl: Boolean(config.databaseUrl),
    nodeEnv: config.nodeEnv,
    // Safe to expose: this is meant to be the literal word "postgres" or "memory", never a secret.
    // Reported raw (not run through the strict === 'postgres' parse) so a stray case/whitespace
    // mismatch is visible directly, instead of silently falling back to "memory".
    rawPersistenceEnv: process.env.PERSISTENCE ?? null,
    // Which of the accepted var names actually resolved, and enough about the value to confirm it
    // looks like a real Postgres URL — never the URL itself.
    databaseUrlSource: process.env.DATABASE_URL
      ? 'DATABASE_URL'
      : process.env.POSTGRES_URL
        ? 'POSTGRES_URL'
        : process.env.POSTGRES_PRISMA_URL
          ? 'POSTGRES_PRISMA_URL'
          : process.env.POSTGRES_URL_NON_POOLING
            ? 'POSTGRES_URL_NON_POOLING'
            : null,
    databaseUrlLooksValid: config.databaseUrl?.startsWith('postgres') ?? false,
    databaseUrlLength: config.databaseUrl?.length ?? 0,
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

import { NextResponse } from 'next/server';
import { Pool } from 'pg';
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
    // Diagnostic-only: introspect the actual schema so a mismatch is visible directly instead of
    // guessed at. Safe to expose — table/column names only, never row data or the connection string.
    let schema: unknown = null;
    if (config.databaseUrl) {
      try {
        const pool = new Pool({ connectionString: config.databaseUrl });
        const result = await pool.query(
          `SELECT table_name, column_name, data_type FROM information_schema.columns
           WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
        );
        schema = result.rows;
        await pool.end();
      } catch (introspectError) {
        schema = { introspectFailed: String((introspectError as Error)?.message ?? introspectError) };
      }
    }
    return NextResponse.json({
      ...base,
      repositoryReachable: false,
      error: String((error as Error)?.message ?? error),
      schema,
    });
  }
}

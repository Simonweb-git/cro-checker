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

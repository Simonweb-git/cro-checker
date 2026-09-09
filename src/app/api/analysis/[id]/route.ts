import { NextResponse } from 'next/server';
import { getRepository } from '../../../../lib/store.js';

export const runtime = 'nodejs';
// A dynamic [id] segment already makes this route dynamic in practice, but force it explicitly —
// this is the exact route that must poll live state, never a frozen build-time response.
export const dynamic = 'force-dynamic';

/** GET /api/analysis/:id — status while running, FinalReport once the job is terminal. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const repository = await getRepository();
  const job = await repository.getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isTerminal = ['completed', 'partial', 'failed'].includes(job.stage);
  const report = isTerminal ? await repository.getReport(id) : null;

  return NextResponse.json({
    analysisId: job.analysisId,
    rootUrl: job.rootUrl,
    stage: job.stage,
    selectedPages: job.selectedPages,
    error: job.error,
    partialReasons: job.partialReasons,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    report,
  });
}

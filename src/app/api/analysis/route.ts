import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { getConfig, getRepository } from '../../../lib/store.js';
import { createAnalysisJob, runAnalysis } from '../../../core/pipeline/orchestrator.js';
import { normalizeRootUrl, assertUrlAllowed, UrlBlockedError } from '../../../core/security/url-guard.js';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/analysis — creates a job and returns analysisId immediately (build spec §7).
 * The scan itself runs via `after()` so it continues past the response in the same invocation,
 * which is the supported way to background work in a Vercel serverless function (see lib/store.ts
 * for the durability caveat this does NOT solve).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json_body' }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    return NextResponse.json({ error: 'missing_url' }, { status: 400 });
  }

  let normalized: string;
  try {
    normalized = normalizeRootUrl(url);
    await assertUrlAllowed(normalized);
  } catch (error) {
    const reason = error instanceof UrlBlockedError ? error.reason : 'invalid_url';
    return NextResponse.json({ error: 'url_rejected', reason }, { status: 400 });
  }

  const repository = await getRepository();
  const job = createAnalysisJob(normalized);
  await repository.createJob(job);

  const config = getConfig();
  after(async () => {
    try {
      await runAnalysis(job, { config, repository });
    } catch (error) {
      // runAnalysis already records failures on the job; this is a last-resort safety net.
      console.error(`[analysis ${job.analysisId}] unhandled error`, error);
    }
  });

  return NextResponse.json({ analysisId: job.analysisId, stage: job.stage }, { status: 202 });
}

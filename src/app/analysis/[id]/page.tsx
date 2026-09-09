'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DISPLAY_ORDER, STAGE_LABELS, stageIndex } from '../../../lib/stage-labels.js';

interface StatusResponse {
  analysisId: string;
  rootUrl: string;
  stage: string;
  selectedPages: Array<{ url: string; pageType: string; selectionReason: string }>;
  error: string | null;
  partialReasons: string[];
}

export default function AnalysisProgressPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const redirected = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveFailures = 0;
    // A single failed poll is not proof the analysis doesn't exist — it could be a cold start, a
    // transient database hiccup, or a request that raced the job's own creation. Only report a
    // permanent failure after several consecutive misses spanning a real amount of time.
    const MAX_CONSECUTIVE_FAILURES = 6;

    async function poll() {
      try {
        const response = await fetch(`/api/analysis/${params.id}`, { cache: 'no-store' });
        if (!response.ok) {
          consecutiveFailures += 1;
          if (cancelled) return;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            setPollError(
              response.status === 404
                ? 'This analysis could not be found.'
                : 'The analysis service is not responding. Please try again shortly.',
            );
            return;
          }
          setPollError('Waiting for the analysis to start…');
          timer = setTimeout(poll, 2000);
          return;
        }
        consecutiveFailures = 0;
        const data: StatusResponse = await response.json();
        if (cancelled) return;
        setStatus(data);
        setPollError(null);

        if (['completed', 'partial'].includes(data.stage) && !redirected.current) {
          redirected.current = true;
          router.push(`/report/${params.id}`);
          return;
        }
        if (data.stage === 'failed') return;
        timer = setTimeout(poll, 1800);
      } catch {
        consecutiveFailures += 1;
        if (cancelled) return;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          setPollError('Lost connection to the analysis service. Please refresh to try again.');
          return;
        }
        setPollError('Lost connection to the analysis service. Retrying…');
        timer = setTimeout(poll, 3000);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.id, router]);

  return (
    <main className="shell">
      <div className="progress-card">
        <h2>Analysing your website</h2>
        <div className="url">{status?.rootUrl ?? '…'}</div>

        {pollError && <div className="error-banner">{pollError}</div>}

        {status?.stage === 'failed' ? (
          <div className="error-banner">
            The scan could not be completed{status.error ? `: ${status.error}` : '.'} Please try again,
            or try a different page on the same site.
          </div>
        ) : (
          <ul className="stage-list">
            {DISPLAY_ORDER.filter((s) => s !== 'queued').map((stage) => {
              const currentIndex = stageIndex(status?.stage ?? 'queued');
              const thisIndex = stageIndex(stage);
              const isDone = thisIndex < currentIndex;
              const isActive = thisIndex === currentIndex;
              return (
                <li key={stage} className={isDone ? 'done' : isActive ? 'active' : ''}>
                  <span className="stage-dot" />
                  {STAGE_LABELS[stage]}
                </li>
              );
            })}
          </ul>
        )}

        {status && status.selectedPages.length > 0 && (
          <div className="selected-pages">
            <h4>Pages selected for analysis</h4>
            {status.selectedPages.map((page) => (
              <span className="page-chip" key={page.url} title={page.selectionReason}>
                {page.pageType}
              </span>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

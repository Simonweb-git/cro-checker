'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LandingPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(explainError(data.error, data.reason));
        setSubmitting(false);
        return;
      }
      router.push(`/analysis/${data.analysisId}`);
    } catch {
      setError('Could not reach the analysis service. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <h1>Find your biggest conversion problems in one scan</h1>
        <p className="lead">
          Enter a website URL. We analyse up to five high-value pages, establish who the site is
          written for, and return an evidence-backed CRO health check with concrete fixes.
        </p>
        <form className="scan-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="yourcompany.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? 'Starting…' : 'Run free scan'}
          </button>
        </form>
        {error && <div className="error-banner">{error}</div>}
      </section>

      <section className="features">
        <div className="feature">
          <h3>Multi-page evidence</h3>
          <p>Homepage plus up to four complementary pages, not a single screenshot judged in isolation.</p>
        </div>
        <div className="feature">
          <h3>Cross-page consistency</h3>
          <p>Catches contradictions between what your homepage promises and what your pricing or contact page delivers.</p>
        </div>
        <div className="feature">
          <h3>Evidence-backed findings</h3>
          <p>Every material claim cites the exact element it came from. No invented statistics or guarantees.</p>
        </div>
      </section>
    </main>
  );
}

function explainError(code?: string, reason?: string): string {
  if (code === 'missing_url') return 'Enter a website URL to scan.';
  if (code === 'url_rejected') {
    if (reason === 'private_address_literal' || reason === 'resolves_to_private_address') {
      return 'That address is not a public website and cannot be scanned.';
    }
    if (reason === 'unsupported_scheme') return 'Please enter an http or https website URL.';
    return 'That URL could not be validated. Check it and try again.';
  }
  return 'Something went wrong starting the scan. Please try again.';
}

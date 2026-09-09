'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { FinalReport, StandardReport, CategoryScore } from '../../../core/schemas/index.js';

interface StatusResponse {
  stage: string;
  report: FinalReport | null;
  error: string | null;
}

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Retry before giving up: the redirect from the progress page can race a transient blip (cold
    // start, brief database hiccup) on this very next request. A single failure here is not proof
    // the report doesn't exist.
    const MAX_ATTEMPTS = 5;

    async function load(attempt: number) {
      try {
        const response = await fetch(`/api/analysis/${params.id}`, { cache: 'no-store' });
        if (!response.ok) throw response;
        const body = await response.json();
        if (!cancelled) setData(body);
      } catch {
        if (cancelled) return;
        if (attempt >= MAX_ATTEMPTS) {
          setLoadError('This report could not be loaded.');
          return;
        }
        setTimeout(() => load(attempt + 1), 1500 * attempt);
      }
    }
    load(1);
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loadError) {
    return (
      <main className="shell">
        <div className="error-banner" style={{ marginTop: 40 }}>
          {loadError}
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="shell">
        <p style={{ marginTop: 40, color: 'var(--text-muted)' }}>Loading report…</p>
      </main>
    );
  }
  if (!data.report) {
    return (
      <main className="shell">
        <div className="error-banner" style={{ marginTop: 40 }}>
          No report is available for this analysis yet (stage: {data.stage}).
        </div>
      </main>
    );
  }

  if (data.report.kind === 'unsupported_archetype') {
    const report = data.report;
    return (
      <main className="shell">
        <div className="report-header">
          <h1>This site is outside the current scoring rubric</h1>
          <div className="report-meta">{report.rootUrl}</div>
        </div>
        <div className="finding-card sev-MEDIUM">
          <p>{report.explanation}</p>
          <div className="finding-field">
            <span className="k">Detected archetype</span>
            {report.detectedArchetype}
          </div>
          {report.extractedContext.primaryConversionGoal && (
            <div className="finding-field">
              <span className="k">Primary conversion goal (best guess)</span>
              {report.extractedContext.primaryConversionGoal}
            </div>
          )}
        </div>
      </main>
    );
  }

  return <StandardReportView report={data.report} />;
}

function StandardReportView({ report }: { report: StandardReport }) {
  return (
    <main className="shell">
      <div className="report-header">
        <h1>
          CRO Health Check
          {report.completeness === 'partial' && <span className="badge badge-partial">Partial</span>}
          {!report.commercialUse && <span className="badge badge-stub">Offline demo data</span>}
        </h1>
        <div className="report-meta">
          {report.rootUrl} · Generated {new Date(report.generatedAt).toLocaleString()}
        </div>
      </div>

      {!report.commercialUse && (
        <div className="error-banner" style={{ margin: '16px 0' }}>
          This report was produced by the deterministic offline provider (no AI provider key
          configured). Scores are rubric-calculated but findings and copy are templated, not a real
          diagnosis. Configure ANTHROPIC_API_KEY / OPENAI_API_KEY for a commercial-grade report.
        </div>
      )}
      {report.partialReasons.length > 0 && (
        <div className="error-banner" style={{ margin: '16px 0' }}>
          This analysis is partial: {report.partialReasons.join('; ')}.
        </div>
      )}

      {/* 1. Dashboard */}
      <Dashboard report={report} />

      {/* 2. Executive summary */}
      <ReportSection title="Executive Summary">
        <p className="prose">{report.executiveSummary}</p>
      </ReportSection>

      {/* 3. Top conversion problems */}
      <ReportSection
        title={`Top Conversion Problems (${report.findings.length})`}
        lead={report.findings.length === 0 ? 'No high-confidence problems survived evidence and QA review.' : undefined}
      >
        {report.findings.map((finding) => (
          <div className={`finding-card sev-${finding.severity}`} key={finding.findingId}>
            <div className="finding-head">
              <span className={`sev-tag sev-${finding.severity}`}>{finding.severity}</span>
              <h3>{finding.title}</h3>
            </div>
            <div className="finding-field">
              <span className="k">Observed</span>
              {finding.observedFact}
            </div>
            <div className="finding-field">
              <span className="k">Why it hurts</span>
              {finding.whyItHurts}
            </div>
            <div className="finding-field">
              <span className="k">Recommended direction</span>
              {finding.recommendedDirection}
            </div>
            <div className="evidence-refs">
              Expected impact: {finding.expectedImpact} · Confidence: {finding.confidence} · Evidence:{' '}
              {finding.evidenceRefs.map((ref) => (
                <code key={ref}>{ref}</code>
              ))}
            </div>
          </div>
        ))}
      </ReportSection>

      {/* 4. Cross-page consistency */}
      <ReportSection title="Cross-page Consistency Analysis">
        <div className="dashboard" style={{ marginBottom: 18 }}>
          {report.scores.consistency.map((category) => (
            <ScoreCard key={category.categoryId} category={category} />
          ))}
        </div>
        <p className="prose">{report.consistencyAnalysis}</p>
      </ReportSection>

      {/* 5. ICP + primary conversion goal */}
      <ReportSection title="ICP + Primary Conversion Goal">
        <div className="finding-field">
          <span className="k">Site archetype</span>
          {report.siteContext.siteArchetype.value} ({report.siteContext.siteArchetype.confidence} confidence)
        </div>
        <div className="finding-field">
          <span className="k">Primary conversion goal</span>
          {report.siteContext.primaryConversionGoal.value} ({report.siteContext.primaryConversionGoal.confidence}{' '}
          confidence)
        </div>
        <div className="finding-field">
          <span className="k">Primary ICP</span>
          {report.siteContext.primaryICP.value}
        </div>
        {report.siteContext.secondaryICP && (
          <div className="finding-field">
            <span className="k">Secondary ICP</span>
            {report.siteContext.secondaryICP.value}
          </div>
        )}
      </ReportSection>

      {/* 6+7+8. Fixes, split by kind for readability */}
      <ReportSection
        title="Message, CTA & Copy Fixes"
        lead={report.fixes.length === 0 ? 'No fixes were generated — either no findings needed one, or evidence did not support grounded replacement copy.' : undefined}
      >
        {report.fixes.map((fix) => (
          <FixCard key={fix.fixId} fix={fix} />
        ))}
      </ReportSection>

      {/* 9. Trust & conversion review */}
      <ReportSection title="Trust & Conversion Review">
        <p className="prose">{report.trustReview}</p>
      </ReportSection>

      {/* 10. Performance impact */}
      <ReportSection title="Performance Impact">
        <p className="prose">{report.performanceImpact}</p>
      </ReportSection>

      {/* 11. Action plan */}
      <ReportSection title={`Prioritized Quick-Win Action Plan (${report.actionPlan.length})`}>
        <table className="action-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Impact</th>
              <th>Effort</th>
            </tr>
          </thead>
          <tbody>
            {report.actionPlan.map((action) => (
              <tr key={action.actionId}>
                <td>{action.action}</td>
                <td>{action.expectedImpact}</td>
                <td>
                  <span className="effort-tag">
                    {action.effort === 'quick_win' ? 'Quick win' : 'Deeper work'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportSection>

      <p className="footer-note">
        Analysed {report.analyzedPages.length} page(s) · scoringVersion {report.versions.scoringVersion} ·
        extractorVersion {report.versions.extractorVersion} · promptVersion {report.versions.promptVersion}
      </p>
    </main>
  );
}

function Dashboard({ report }: { report: StandardReport }) {
  return (
    <div className="dashboard">
      <div className="score-card overall-card">
        <div>
          <div className="label">Overall CRO Health</div>
          {report.scores.overall.status === 'available' ? (
            <>
              <div className={`value band-${report.scores.overall.band}`}>{report.scores.overall.score}</div>
              <div className={`band band-${report.scores.overall.band}`}>{report.scores.overall.band}</div>
            </>
          ) : (
            <div className="value" style={{ fontSize: 16 }}>
              Unavailable — {report.scores.overall.reason}
            </div>
          )}
        </div>
      </div>
      {report.scores.dashboard.map((category) => (
        <ScoreCard key={category.categoryId} category={category} />
      ))}
    </div>
  );
}

function ScoreCard({ category }: { category: CategoryScore }) {
  if (category.status === 'unavailable') {
    return (
      <div className="score-card unavailable">
        <div className="label">{category.label}</div>
        <div className="value">Unavailable</div>
        <div className="band">{category.reason.replace(/_/g, ' ')}</div>
      </div>
    );
  }
  return (
    <div className="score-card">
      <div className="label">{category.label}</div>
      <div className={`value band-${category.band}`}>{category.score}</div>
      <div className={`band band-${category.band}`}>{category.band}</div>
    </div>
  );
}

function ReportSection({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {lead && <p className="section-lead">{lead}</p>}
      {children}
    </section>
  );
}

function FixCard({ fix }: { fix: StandardReport['fixes'][number] }) {
  return (
    <div className="fix-card">
      <h3>{fix.whatToChange}</h3>
      <div className="fix-page">
        {fix.pageId} · {fix.placement}
      </div>
      <div className="change-block">
        <div>
          <span className="k">Current issue</span>
          {fix.currentIssue}
        </div>
        <div>
          <span className="k">Rationale</span>
          {fix.rationale}
        </div>
      </div>
      {fix.kind === 'copy' && (
        <div className="change-block" style={{ marginTop: 10 }}>
          <div>
            <span className="k">Current copy</span>
            {fix.currentCopy ?? '—'}
          </div>
          <div>
            <span className="k">Proposed copy</span>
            {fix.proposedCopy}
          </div>
        </div>
      )}
      {fix.kind === 'hero' && fix.alternatives.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span className="k" style={{ display: 'block', marginBottom: 6 }}>
            Hero alternatives
          </span>
          {fix.alternatives.map((alt, i) => (
            <div className="change-block" key={i} style={{ marginBottom: 8 }}>
              <div>
                <span className="k">Headline</span>
                {alt.headline}
              </div>
              <div>
                <span className="k">Subheadline</span>
                {alt.subheadline}
              </div>
            </div>
          ))}
        </div>
      )}
      {fix.kind === 'cta' && (
        <div style={{ marginTop: 10 }}>
          <span className="k" style={{ display: 'block', marginBottom: 6 }}>
            Strategy
          </span>
          <p className="prose" style={{ margin: 0 }}>
            {fix.strategy}
          </p>
        </div>
      )}
      {fix.kind === 'structural' && (
        <div style={{ marginTop: 10 }}>
          <span className="k" style={{ display: 'block', marginBottom: 6 }}>
            Recommendation
          </span>
          <p className="prose" style={{ margin: 0 }}>
            {fix.recommendation}
          </p>
        </div>
      )}
    </div>
  );
}

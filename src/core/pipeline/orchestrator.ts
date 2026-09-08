import { randomUUID } from 'node:crypto';
import type { EngineConfig } from '../config.js';
import { hasRealModelAccess } from '../config.js';
import type { AnalysisRepository } from '../persistence/repository.js';
import { LocalStepRunner, type WorkflowRunner } from './step-runner.js';
import { assertTransition } from './state-machine.js';
import type { AnalysisJob, JobStage } from '../schemas/job.js';
import { WebsiteEvidence, type PageEvidence, type PerformanceMeasurement } from '../schemas/evidence.js';
import { SiteContext } from '../schemas/context.js';
import { ScoreSet } from '../schemas/scores.js';
import { DiagnosticFindings } from '../schemas/findings.js';
import { FixSet } from '../schemas/fixes.js';
import { QAResults } from '../schemas/qa.js';
import { FinalReport } from '../schemas/report.js';
import { VERSIONS } from '../schemas/common.js';
import { assertUrlAllowed, normalizeRootUrl, registrableDomain } from '../security/url-guard.js';
import type { CrawlAdapter } from '../crawl/types.js';
import { StaticFetchAdapter } from '../crawl/static-adapter.js';
import { PlaywrightAdapter } from '../crawl/playwright-adapter.js';
import { RobotsPolicy } from '../discovery/robots.js';
import { discoverPages } from '../discovery/discover.js';
import { EXTRACTOR_VERSION, extractPage } from '../extract/extractor.js';
import type { PerformanceAdapter } from '../performance/adapter.js';
import { NullPerformanceAdapter, PageSpeedInsightsAdapter } from '../performance/adapter.js';
import { BudgetedModelClient, type ModelClient } from '../ai/model-client.js';
import { VercelModelClient } from '../ai/vercel-client.js';
import { StubModelClient } from '../ai/stub-client.js';
import { runSiteContextStage } from '../ai/stages/site-context.js';
import { runSignalStage } from '../ai/stages/signals.js';
import { runDiagnosticStage } from '../ai/stages/diagnose.js';
import { runFixStage } from '../ai/stages/fix.js';
import { runQAStage } from '../ai/stages/qa.js';
import { runNarrationStage } from '../ai/stages/narrate.js';
import { computeScores } from '../scoring/scorer.js';
import { assembleReport } from '../report/assemble.js';
import { SCORING_VERSION } from '../scoring/rubric.v1.js';
import { PROMPT_VERSION } from '../ai/prompts.js';

export interface RunAnalysisDeps {
  config: EngineConfig;
  repository: AnalysisRepository;
  crawlAdapter?: CrawlAdapter;
  performanceAdapter?: PerformanceAdapter;
  modelClient?: ModelClient;
  runner?: WorkflowRunner;
  onStage?: (stage: JobStage) => void;
}

export interface RunAnalysisResult {
  analysisId: string;
  stage: JobStage;
  report: FinalReport | null;
  error?: string;
}

export function createAnalysisJob(rootUrl: string): AnalysisJob {
  const now = new Date().toISOString();
  return {
    // Non-guessable id: reports are retrievable without authentication (build spec §18).
    analysisId: randomUUID(),
    rootUrl,
    stage: 'queued',
    createdAt: now,
    updatedAt: now,
    selectedPages: [],
    error: null,
    partialReasons: [],
  };
}

function buildModelClient(config: EngineConfig, provided?: ModelClient): ModelClient {
  if (provided) return provided;
  if (hasRealModelAccess(config)) return new VercelModelClient(config);
  if (config.nodeEnv === 'production') {
    // The offline provider must never reach a paying user (ADR-006).
    throw new Error('No AI provider key configured. Refusing to run the offline stub provider in production.');
  }
  return new StubModelClient();
}

export async function runAnalysis(
  job: AnalysisJob,
  deps: RunAnalysisDeps,
): Promise<RunAnalysisResult> {
  const { config, repository } = deps;
  const durations: Record<string, number> = {};
  const runner = deps.runner ?? new LocalStepRunner(repository, { analysisId: job.analysisId, durations });
  const partialReasons: string[] = [];
  const startedAt = Date.now();

  let currentStage: JobStage = job.stage;
  const setStage = async (stage: JobStage) => {
    assertTransition(currentStage, stage);
    currentStage = stage;
    await repository.setStage(job.analysisId, stage);
    deps.onStage?.(stage);
  };

  const budgetGuard = () => {
    if (Date.now() - startedAt > config.budgets.maxDurationMs) {
      throw new Error('Analysis exceeded the configured duration budget');
    }
  };

  let adapter: CrawlAdapter | undefined;

  try {
    // 0 ------------------------------------------------------- model client
    // Constructed INSIDE the try block: e.g. the no-key-in-production guard must land the job on
    // "failed" with a readable error, not escape uncaught and leave the job stuck at "queued" forever.
    const modelClient = new BudgetedModelClient(buildModelClient(config, deps.modelClient), config.budgets);
    const versions = {
      extractorVersion: EXTRACTOR_VERSION,
      promptVersion: PROMPT_VERSION,
      scoringVersion: SCORING_VERSION,
      modelConfigVersion: modelClient.modelConfigVersion,
      reportSchemaVersion: VERSIONS.reportSchemaVersion,
    };

    // 1 ---------------------------------------------------------------- URL
    await setStage('validating_url');
    const rootUrl = normalizeRootUrl(job.rootUrl);
    await assertUrlAllowed(rootUrl);
    const scopeDomain = registrableDomain(new URL(rootUrl).hostname);

    adapter =
      deps.crawlAdapter ??
      (config.crawl.adapter === 'playwright'
        ? new PlaywrightAdapter(config.crawl, { scopeDomain })
        : new StaticFetchAdapter(config.crawl, { scopeDomain }));

    // 2 ---------------------------------------------------------- discovery
    await setStage('discovering_pages');
    const robots = config.crawl.respectRobots ? await loadRobots(rootUrl, config.crawl.userAgent) : RobotsPolicy.allowAll();
    const discovery = await runner.step('discovery', async () =>
      discoverPages(rootUrl, adapter!, {
        maxCandidates: config.crawl.maxCandidates,
        maxPages: config.crawl.maxPages,
        respectRobots: config.crawl.respectRobots,
      }, robots),
    );
    await repository.updateJob(job.analysisId, {
      selectedPages: discovery.selected.map((page) => ({
        url: page.url,
        pageType: page.pageType,
        selectionReason: page.selectionReason,
      })),
    });

    // 3 --------------------------------------------------------- extraction
    await setStage('extracting_pages');
    budgetGuard();
    const evidence = await runner.step('evidence', async () => {
      const pages: PageEvidence[] = [];
      const failedPages: WebsiteEvidence['failedPages'] = [];
      for (const [index, candidate] of discovery.selected.entries()) {
        try {
          const fetched =
            index === 0 && discovery.homepageHtml
              ? { requestedUrl: candidate.url, finalUrl: candidate.url, status: 200, html: discovery.homepageHtml, bytes: discovery.homepageHtml.length }
              : await adapter!.fetchPage(candidate.url);
          pages.push(
            extractPage({
              pageIndex: index + 1,
              page: fetched,
              pageType: candidate.pageType,
              selectionReason: candidate.selectionReason,
            }),
          );
        } catch (error) {
          // A failed page is recorded and never cited as analysed (reasoning spec §16).
          failedPages.push({ url: candidate.url, reason: String((error as Error).message ?? error) });
        }
      }
      if (pages.length === 0) throw new Error('No page could be extracted from this website');
      const stats = adapter!.stats();
      return WebsiteEvidence.parse({
        schemaVersion: 'evidence-v1',
        analysisId: job.analysisId,
        extractorVersion: EXTRACTOR_VERSION,
        domain: scopeDomain,
        rootUrl,
        capturedAt: new Date().toISOString(),
        pages,
        failedPages,
        performance: [],
        crawlStats: {
          requests: stats.requests,
          bytes: stats.bytes,
          candidatesConsidered: discovery.candidatesConsidered,
        },
      });
    });
    if (evidence.failedPages.length > 0) {
      partialReasons.push(`${evidence.failedPages.length} selected page(s) could not be extracted`);
    }
    if (evidence.pages.length < 2) {
      partialReasons.push('Fewer than two pages could be analysed, so cross-page consistency is unavailable');
    }

    // 4 -------------------------------------------------------- performance
    await setStage('measuring_performance');
    const performanceAdapter =
      deps.performanceAdapter ??
      (config.performance.adapter === 'psi'
        ? new PageSpeedInsightsAdapter(config.performance.apiKey, config.performance.timeoutMs)
        : new NullPerformanceAdapter());
    const measurements = await runner.step('performance', async () => {
      const homepage = evidence.pages[0];
      if (!homepage) return [] as PerformanceMeasurement[];
      const measurement = await performanceAdapter.measure(homepage.url, homepage.pageId);
      return measurement ? [measurement] : [];
    });
    const evidenceWithPerf = { ...evidence, performance: measurements };
    if (measurements.length === 0) {
      partialReasons.push('No performance measurement was available, so Performance Impact is unavailable');
    }

    // 5 ------------------------------------------------------------ scoring
    await setStage('scoring');
    budgetGuard();
    const context = SiteContext.parse(
      await runner.step('site_context', async () =>
        runSiteContextStage({
          analysisId: job.analysisId,
          evidence: evidenceWithPerf,
          configuredLanguage: config.reportLanguage,
          model: config.models.siteContext,
          client: modelClient,
        }),
      ),
    );

    if (context.unsupportedArchetype || context.siteArchetype.value === 'ecommerce_unsupported') {
      // No lead-gen score is produced at all (reasoning spec §16).
      const report = assembleReport({
        analysisId: job.analysisId,
        rootUrl,
        evidence: evidenceWithPerf,
        context,
        scores: emptyScores(job.analysisId),
        findings: { schemaVersion: 'findings-v1', analysisId: job.analysisId, findings: [], droppedFindings: [] },
        fixes: { schemaVersion: 'fixes-v1', analysisId: job.analysisId, fixes: [], droppedFixes: [] },
        qa: { schemaVersion: 'qa-v1', analysisId: job.analysisId, results: [], stats: { pass: 0, revise: 0, reject: 0, revisionAttempts: 0 } },
        narration: { executiveSummary: '', narrations: [], consistencyAnalysis: '', trustReview: '', performanceImpact: '' },
        versions,
        commercialUse: modelClient.commercialUse,
        partialReasons,
        telemetry: telemetry(durations, modelClient, evidenceWithPerf),
      });
      await repository.saveReport(job.analysisId, report);
      await setStage('completed');
      return { analysisId: job.analysisId, stage: 'completed', report };
    }

    const assessments = await runner.step('signals', async () =>
      runSignalStage({
        evidence: evidenceWithPerf,
        context,
        model: config.models.signals,
        client: modelClient,
      }),
    );
    const scores = ScoreSet.parse(
      computeScores({ analysisId: job.analysisId, evidence: evidenceWithPerf, context, assessments }),
    );

    // 6 ---------------------------------------------------------- diagnosis
    await setStage('diagnosing');
    budgetGuard();
    const rawFindings = DiagnosticFindings.parse(
      await runner.step('diagnostic', async () =>
        runDiagnosticStage({
          analysisId: job.analysisId,
          evidence: evidenceWithPerf,
          context,
          scores,
          model: config.models.diagnostic,
          client: modelClient,
        }),
      ),
    );

    // 7 --------------------------------------------------------------- fixes
    await setStage('generating_fixes');
    budgetGuard();
    const rawFixes = FixSet.parse(
      await runner.step('fixes', async () =>
        runFixStage({
          analysisId: job.analysisId,
          evidence: evidenceWithPerf,
          context,
          findings: rawFindings,
          model: config.models.fix,
          client: modelClient,
        }),
      ),
    );

    // 8 ------------------------------------------------------------------ QA
    await setStage('qa_review');
    budgetGuard();
    const qaResult = await runner.step('qa', async () =>
      runQAStage({
        analysisId: job.analysisId,
        evidence: evidenceWithPerf,
        context,
        scores,
        findings: rawFindings,
        fixes: rawFixes,
        model: config.models.qa,
        client: modelClient,
      }),
    );
    const findings = DiagnosticFindings.parse(qaResult.findings);
    const fixes = FixSet.parse(qaResult.fixes);
    const qa = QAResults.parse(qaResult.qa);
    if (qa.stats.reject > 0) {
      partialReasons.push(`${qa.stats.reject} item(s) were removed by independent QA`);
    }

    // 9 -------------------------------------------------------------- report
    await setStage('assembling_report');
    const narration = await runner.step('narration', async () =>
      runNarrationStage({
        evidence: evidenceWithPerf,
        context,
        scores,
        findings,
        model: config.models.diagnostic,
        client: modelClient,
      }),
    );

    const report = assembleReport({
      analysisId: job.analysisId,
      rootUrl,
      evidence: evidenceWithPerf,
      context,
      scores,
      findings,
      fixes,
      qa,
      narration,
      versions,
      commercialUse: modelClient.commercialUse,
      partialReasons,
      telemetry: telemetry(durations, modelClient, evidenceWithPerf),
    });

    await repository.saveReport(job.analysisId, report);
    const finalStage: JobStage = partialReasons.length > 0 ? 'partial' : 'completed';
    await repository.updateJob(job.analysisId, { partialReasons });
    await setStage(finalStage);
    return { analysisId: job.analysisId, stage: finalStage, report };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    await repository.updateJob(job.analysisId, { error: message, partialReasons });
    if (!['completed', 'partial', 'failed'].includes(currentStage)) {
      currentStage = 'failed';
      await repository.setStage(job.analysisId, 'failed');
      deps.onStage?.('failed');
    }
    return { analysisId: job.analysisId, stage: 'failed', report: null, error: message };
  } finally {
    await adapter?.close?.();
  }
}

function telemetry(
  durations: Record<string, number>,
  client: BudgetedModelClient,
  evidence: WebsiteEvidence,
) {
  const totals = client.totals();
  return {
    stageDurationsMs: durations,
    modelCalls: totals.modelCalls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    estimatedCostUsd: totals.estimatedCostUsd,
    crawlRequests: evidence.crawlStats.requests,
    crawlBytes: evidence.crawlStats.bytes,
  };
}

function emptyScores(analysisId: string) {
  return ScoreSet.parse({
    schemaVersion: 'scores-v1',
    analysisId,
    scoringVersion: SCORING_VERSION,
    overall: { status: 'unavailable', reason: 'not_applicable_archetype' },
    dashboard: [],
    consistency: [],
  });
}

async function loadRobots(rootUrl: string, userAgent: string): Promise<RobotsPolicy> {
  try {
    const url = new URL('/robots.txt', rootUrl).toString();
    await assertUrlAllowed(url);
    const response = await fetch(url, { headers: { 'user-agent': userAgent } });
    if (!response.ok) return RobotsPolicy.allowAll();
    return new RobotsPolicy(await response.text(), userAgent);
  } catch {
    return RobotsPolicy.allowAll();
  }
}

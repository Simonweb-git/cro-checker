import type { PerformanceMeasurement } from '../schemas/evidence.js';

export interface PerformanceAdapter {
  readonly name: string;
  /** Must resolve to null rather than throw: performance failure never fails a CRO scan (§12). */
  measure(url: string, pageId: string): Promise<PerformanceMeasurement | null>;
}

export class NullPerformanceAdapter implements PerformanceAdapter {
  readonly name = 'none';
  async measure(): Promise<null> {
    return null;
  }
}

/** PageSpeed Insights lab data (mobile). Measured by tooling, never estimated by a model. */
export class PageSpeedInsightsAdapter implements PerformanceAdapter {
  readonly name = 'psi';

  constructor(
    private readonly apiKey: string | undefined,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async measure(url: string, pageId: string): Promise<PerformanceMeasurement | null> {
    const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('strategy', 'mobile');
    endpoint.searchParams.set('category', 'performance');
    if (this.apiKey) endpoint.searchParams.set('key', this.apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(endpoint.toString(), { signal: controller.signal });
      if (!response.ok) return null;
      const body: any = await response.json();
      const audits = body?.lighthouseResult?.audits;
      if (!audits) return null;
      const numeric = (id: string): number | undefined => {
        const value = audits[id]?.numericValue;
        return typeof value === 'number' ? value : undefined;
      };
      return {
        pageId,
        source: 'pagespeed-insights/lighthouse',
        measuredAt: new Date().toISOString(),
        strategy: 'mobile',
        lcpMs: numeric('largest-contentful-paint'),
        clsScore: numeric('cumulative-layout-shift'),
        tbtMs: numeric('total-blocking-time'),
        ttfbMs: numeric('server-response-time'),
      };
    } catch {
      return null; // timeout or transport failure — the scan continues
    } finally {
      clearTimeout(timer);
    }
  }
}

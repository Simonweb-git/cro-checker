import { assertUrlAllowed, UrlBlockedError, type UrlGuardOptions } from '../security/url-guard.js';
import type { CrawlAdapter, CrawlBudget, CrawlStats, FetchedPage } from './types.js';

export class CrawlBudgetExceededError extends Error {
  constructor(readonly kind: 'requests' | 'bytes') {
    super(`Crawl budget exceeded: ${kind}`);
    this.name = 'CrawlBudgetExceededError';
  }
}

const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/xml', 'application/xml'];

/**
 * Default crawl adapter: plain HTTP, no JS execution.
 * Redirects are followed MANUALLY so every hop is re-validated by the URL guard (ADR-008).
 */
export class StaticFetchAdapter implements CrawlAdapter {
  readonly name = 'static';
  private requests = 0;
  private bytes = 0;

  constructor(
    private readonly budget: CrawlBudget,
    private readonly guard: UrlGuardOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  stats(): CrawlStats {
    return { requests: this.requests, bytes: this.bytes };
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    let currentUrl = url;
    for (let hop = 0; hop <= this.budget.maxRedirects; hop++) {
      if (this.requests >= this.budget.maxRequests) throw new CrawlBudgetExceededError('requests');
      if (this.bytes >= this.budget.maxBytes) throw new CrawlBudgetExceededError('bytes');

      // Re-validate on every hop, not just the first.
      await assertUrlAllowed(currentUrl, this.guard);
      this.requests += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.budget.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(currentUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'user-agent': this.budget.userAgent, accept: 'text/html,application/xhtml+xml' },
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect without location from ${currentUrl}`);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType && !ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
        throw new Error(`Unsupported content-type ${contentType} at ${currentUrl}`);
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (declaredLength > this.budget.maxBytes) throw new CrawlBudgetExceededError('bytes');

      const html = await this.readCapped(response);
      this.bytes += Buffer.byteLength(html);

      return {
        requestedUrl: url,
        finalUrl: currentUrl,
        status: response.status,
        html,
        bytes: Buffer.byteLength(html),
      };
    }
    throw new UrlBlockedError(url, 'too_many_redirects');
  }

  /** Streams and stops at the cap so a hostile server cannot exhaust memory. */
  private async readCapped(response: Response): Promise<string> {
    const remaining = this.budget.maxBytes - this.bytes;
    if (!response.body) return await response.text();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < remaining) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    await reader.cancel().catch(() => undefined);
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  }
}

import { assertUrlAllowed, type UrlGuardOptions } from '../security/url-guard.js';
import type { CrawlAdapter, CrawlBudget, CrawlStats, FetchedPage, RenderedElementBox } from './types.js';

/**
 * Optional rendering adapter. Loaded by dynamic import so the engine never hard-depends on a browser
 * host (ADR-007). Supplies deterministic layout facts + a screenshot for visual CRO questions only.
 */
export class PlaywrightAdapter implements CrawlAdapter {
  readonly name = 'playwright';
  private requests = 0;
  private bytes = 0;
  private browser: any = null;

  constructor(
    private readonly budget: CrawlBudget,
    private readonly guard: UrlGuardOptions,
    private readonly viewport = { width: 1440, height: 900 },
  ) {}

  stats(): CrawlStats {
    return { requests: this.requests, bytes: this.bytes };
  }

  private async ensureBrowser(): Promise<any> {
    if (this.browser) return this.browser;
    const mod: any = await import('playwright').catch(() => {
      throw new Error('CRAWL_ADAPTER=playwright but the optional "playwright" package is not installed');
    });
    this.browser = await mod.chromium.launch({ headless: true });
    return this.browser;
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    await assertUrlAllowed(url, this.guard);
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: this.viewport,
      userAgent: this.budget.userAgent,
      javaScriptEnabled: true,
    });
    const page = await context.newPage();

    // Re-validate every navigation the page attempts; never let it wander off-scope or inward.
    await page.route('**/*', async (route: any) => {
      const target = route.request().url();
      try {
        await assertUrlAllowed(target, { resolve: this.guard.resolve });
        this.requests += 1;
        if (this.requests > this.budget.maxRequests) return await route.abort();
        await route.continue();
      } catch {
        await route.abort();
      }
    });

    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.budget.timeoutMs,
      });
      await page.waitForTimeout(500);
      const html: string = await page.content();
      const elements: RenderedElementBox[] = await page.evaluate((foldHeight: number) => {
        const selectors = 'h1,h2,h3,a,button,form,input,img,p,section,header,footer,nav';
        const out: any[] = [];
        document.querySelectorAll(selectors).forEach((el) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const style = window.getComputedStyle(el as HTMLElement);
          out.push({
            selector: el.tagName.toLowerCase(),
            text: (el.textContent ?? '').trim().slice(0, 160),
            x: Math.round(rect.x),
            y: Math.round(rect.y + window.scrollY),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            fontSizePx: parseFloat(style.fontSize) || 0,
            aboveFold: rect.y + window.scrollY < foldHeight,
          });
        });
        return out.slice(0, 400);
      }, this.viewport.height);

      const shot: Buffer = await page.screenshot({ fullPage: false });
      this.bytes += Buffer.byteLength(html);

      return {
        requestedUrl: url,
        finalUrl: page.url(),
        status: response?.status() ?? 200,
        html,
        bytes: Buffer.byteLength(html),
        layout: { viewport: this.viewport, elements },
        screenshotBase64: shot.toString('base64'),
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
  }
}

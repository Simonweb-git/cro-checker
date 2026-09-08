import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CrawlAdapter, CrawlStats, FetchedPage } from './types.js';

/**
 * Serves saved HTML from a fixture directory so tests and the eval harness never depend on live
 * third-party websites (build spec: fixtures for deterministic regression tests).
 *
 * Layout: <dir>/index.html for "/", <dir>/<slugified-path>.html for everything else.
 */
export class FixtureCrawlAdapter implements CrawlAdapter {
  readonly name = 'fixture';
  private requests = 0;
  private bytes = 0;

  constructor(private readonly directory: string) {}

  stats(): CrawlStats {
    return { requests: this.requests, bytes: this.bytes };
  }

  static slug(url: string): string {
    const path = new URL(url).pathname.replace(/^\/|\/$/g, '');
    return path === '' ? 'index' : path.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    const file = join(this.directory, `${FixtureCrawlAdapter.slug(url)}.html`);
    if (!existsSync(file)) throw new Error(`Fixture not found for ${url} (${file})`);
    const html = readFileSync(file, 'utf8');
    this.requests += 1;
    this.bytes += Buffer.byteLength(html);
    return { requestedUrl: url, finalUrl: url, status: 200, html, bytes: Buffer.byteLength(html) };
  }
}

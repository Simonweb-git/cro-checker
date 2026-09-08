import { describe, expect, it } from 'vitest';
import { discoverPages } from '../src/core/discovery/discover.js';
import { classifyPageType, isExcludedUrl } from '../src/core/discovery/classify.js';
import { normalizeUrl } from '../src/core/discovery/url-normalize.js';
import { RobotsPolicy } from '../src/core/discovery/robots.js';
import { FixtureCrawlAdapter } from '../src/core/crawl/fixture-adapter.js';

const OPTIONS = { maxCandidates: 40, maxPages: 5, respectRobots: false };

describe('url normalization', () => {
  it('strips fragments, tracking params and trailing slashes', () => {
    expect(normalizeUrl('https://Example.com/Pricing/?utm_source=x#top')).toBe('https://example.com/Pricing');
  });
  it('resolves relative hrefs against the base', () => {
    expect(normalizeUrl('/services', 'https://example.com/about')).toBe('https://example.com/services');
  });
  it('rejects non-http schemes', () => {
    expect(normalizeUrl('mailto:a@b.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('page classification', () => {
  it.each([
    ['https://x.com/', 'homepage'],
    ['https://x.com/pricing', 'pricing'],
    ['https://x.com/priser', 'pricing'],
    ['https://x.com/kontakt', 'contact'],
    ['https://x.com/book-demo', 'demo_booking'],
    ['https://x.com/cases', 'case_studies'],
    ['https://x.com/om-os', 'about'],
    ['https://x.com/blog/how-to-sell', 'blog'],
    ['https://x.com/handelsbetingelser', 'legal'],
  ])('%s => %s', (url, expected) => {
    expect(classifyPageType(url)).toBe(expected);
  });

  it('excludes low-value utility URLs outright', () => {
    for (const url of ['https://x.com/tag/seo', 'https://x.com/cart', 'https://x.com/wp-admin', 'https://x.com/brochure.pdf']) {
      expect(isExcludedUrl(url)).toBe(true);
    }
  });
});

describe('robots policy', () => {
  it('honours Disallow for the wildcard agent', () => {
    const robots = new RobotsPolicy('User-agent: *\nDisallow: /private\nDisallow: /admin', 'CROCheckerBot');
    expect(robots.isAllowed('https://x.com/private/page')).toBe(false);
    expect(robots.isAllowed('https://x.com/services')).toBe(true);
  });
});

describe('discovery and selection', () => {
  it('selects the homepage plus complementary high-intent pages, never more than five', async () => {
    const adapter = new FixtureCrawlAdapter('tests/fixtures/sites/northwind');
    const result = await discoverPages('https://www.example.com', adapter, OPTIONS);

    expect(result.selected).toHaveLength(5);
    expect(result.selected[0]!.pageType).toBe('homepage');
    const types = result.selected.map((s) => s.pageType);
    expect(types).toContain('pricing');
    expect(types).toContain('case_studies');
    expect(types).toContain('contact');
    expect(types).not.toContain('legal');
    // Every selection is explainable (build spec §22).
    for (const page of result.selected) expect(page.selectionReason.length).toBeGreaterThan(20);
  });

  it('respects a smaller page budget', async () => {
    const adapter = new FixtureCrawlAdapter('tests/fixtures/sites/northwind');
    const result = await discoverPages('https://www.example.com', adapter, { ...OPTIONS, maxPages: 3 });
    expect(result.selected).toHaveLength(3);
  });

  it('warns when only the homepage is discoverable', async () => {
    const adapter = new FixtureCrawlAdapter('tests/fixtures/sites/solo');
    const result = await discoverPages('https://www.example.com', adapter, OPTIONS);
    expect(result.selected).toHaveLength(1);
    expect(result.warnings).toContain('only_homepage_discoverable');
  });
});

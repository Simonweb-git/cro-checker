import * as cheerio from 'cheerio';
import type { PageType } from '../schemas/common.js';
import { registrableDomain } from '../security/url-guard.js';
import type { CrawlAdapter } from '../crawl/types.js';
import { classifyPageType, isExcludedUrl } from './classify.js';
import { normalizeUrl, isSameUrl } from './url-normalize.js';

export interface Candidate {
  url: string;
  pageType: PageType;
  label: string;
  source: 'homepage' | 'nav' | 'sitemap' | 'body_link' | 'footer';
  score: number;
  selectionReason: string;
}

export interface DiscoveryResult {
  homepageUrl: string;
  homepageHtml: string;
  selected: Candidate[];
  candidatesConsidered: number;
  warnings: string[];
}

/** CRO relevance by page type: offer clarity, buyer context, proof, price/commitment, conversion path. */
const TYPE_SCORE: Record<PageType, number> = {
  homepage: 100,
  pricing: 82,
  product_service: 78,
  demo_booking: 74,
  solutions: 70,
  case_studies: 66,
  contact: 58,
  about: 52,
  industries: 46,
  other: 25,
  blog: 8,
  legal: 0,
};

const SOURCE_BONUS: Record<Candidate['source'], number> = {
  homepage: 0,
  nav: 12,
  footer: 2,
  sitemap: 4,
  body_link: 0,
};

function depthPenalty(url: string): number {
  const segments = new URL(url).pathname.split('/').filter(Boolean).length;
  return Math.max(0, segments - 1) * 6;
}

export interface DiscoverOptions {
  maxCandidates: number;
  maxPages: number;
  respectRobots: boolean;
}

/**
 * Bounded, commercial-intent aware discovery (build spec §9).
 * Never assumes About/Services/Pricing/Contact exist — it ranks what the site actually links to.
 */
export async function discoverPages(
  rootUrl: string,
  adapter: CrawlAdapter,
  options: DiscoverOptions,
  robots?: { isAllowed(url: string): boolean },
): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const home = await adapter.fetchPage(rootUrl);
  const $ = cheerio.load(home.html);
  const scope = registrableDomain(new URL(home.finalUrl).hostname);

  const canonical = $('link[rel="canonical"]').attr('href');
  const homepageUrl = canonical ? (normalizeUrl(canonical, home.finalUrl) ?? home.finalUrl) : home.finalUrl;

  const candidates = new Map<string, Candidate>();
  const addCandidate = (rawHref: string, label: string, source: Candidate['source']) => {
    if (candidates.size >= options.maxCandidates) return;
    const normalized = normalizeUrl(rawHref, home.finalUrl);
    if (!normalized) return;
    if (registrableDomain(new URL(normalized).hostname) !== scope) return;
    if (isExcludedUrl(normalized)) return;
    if (isSameUrl(normalized, homepageUrl)) return;
    if (robots && !robots.isAllowed(normalized)) return;
    if (candidates.has(normalized)) return;

    const pageType = classifyPageType(normalized, label);
    if (pageType === 'legal') return;
    const score = TYPE_SCORE[pageType] + SOURCE_BONUS[source] - depthPenalty(normalized);
    candidates.set(normalized, {
      url: normalized,
      pageType,
      label: label.trim().slice(0, 80),
      source,
      score,
      selectionReason: '',
    });
  };

  $('header a[href], nav a[href]').each((_, el) => {
    addCandidate($(el).attr('href') ?? '', $(el).text(), 'nav');
  });
  $('footer a[href]').each((_, el) => {
    addCandidate($(el).attr('href') ?? '', $(el).text(), 'footer');
  });

  for (const sitemapUrl of await sitemapUrls(rootUrl, $, home.finalUrl)) {
    if (candidates.size >= options.maxCandidates) break;
    try {
      const sitemap = await adapter.fetchPage(sitemapUrl);
      const $$ = cheerio.load(sitemap.html, { xmlMode: true });
      $$('url > loc').each((_, el) => addCandidate($$(el).text(), '', 'sitemap'));
    } catch {
      warnings.push(`sitemap_unavailable:${sitemapUrl}`);
    }
  }

  $('main a[href], body a[href]').each((_, el) => {
    if (candidates.size >= options.maxCandidates) return;
    addCandidate($(el).attr('href') ?? '', $(el).text(), 'body_link');
  });

  // Homepage always occupies slot 1.
  const selected: Candidate[] = [
    {
      url: homepageUrl,
      pageType: 'homepage',
      label: $('title').text().slice(0, 80),
      source: 'homepage',
      score: TYPE_SCORE.homepage,
      selectionReason: 'Homepage: the entry point every conversion path starts from.',
    },
  ];

  // Complementary selection: prefer distinct page types so five pages cover the journey rather than
  // five service pages.
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const usedTypes = new Set<PageType>(['homepage']);
  for (const candidate of ranked) {
    if (selected.length >= options.maxPages) break;
    if (usedTypes.has(candidate.pageType) && candidate.pageType !== 'product_service') continue;
    usedTypes.add(candidate.pageType);
    selected.push({
      ...candidate,
      selectionReason: reasonFor(candidate),
    });
  }
  // Backfill if the site simply does not have distinct types.
  if (selected.length < options.maxPages) {
    for (const candidate of ranked) {
      if (selected.length >= options.maxPages) break;
      if (selected.some((s) => s.url === candidate.url)) continue;
      selected.push({ ...candidate, selectionReason: reasonFor(candidate) });
    }
  }

  if (selected.length < 2) warnings.push('only_homepage_discoverable');

  return {
    homepageUrl,
    homepageHtml: home.html,
    selected,
    candidatesConsidered: candidates.size,
    warnings,
  };
}

function reasonFor(candidate: Candidate): string {
  const why: Record<PageType, string> = {
    homepage: 'Homepage.',
    pricing: 'Pricing/commitment page: where cost objections and decision friction concentrate.',
    product_service: 'Core offer page: carries the concrete value proposition for the buyer.',
    demo_booking: 'Primary conversion page: the destination of the main call to action.',
    solutions: 'Solution page: shows how the offer is framed against the buyer problem.',
    case_studies: 'Proof page: evidence a considering buyer uses to reduce risk.',
    contact: 'Contact page: final conversion step and identity verification.',
    about: 'About page: trust and credibility signals for a considered purchase.',
    industries: 'Segment page: shows whether messaging is targeted at a specific buyer.',
    other: 'High-signal internal page linked from primary navigation.',
    blog: 'Content page linked prominently from navigation.',
    legal: 'Legal page.',
  };
  return `${why[candidate.pageType]} (linked from ${candidate.source.replace('_', ' ')}, rank score ${candidate.score})`;
}

async function sitemapUrls(rootUrl: string, $: cheerio.CheerioAPI, baseUrl: string): Promise<string[]> {
  const urls = new Set<string>();
  const origin = new URL(baseUrl).origin;
  urls.add(`${origin}/sitemap.xml`);
  $('link[rel="sitemap"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const normalized = normalizeUrl(href, baseUrl);
      if (normalized) urls.add(normalized);
    }
  });
  return [...urls];
}

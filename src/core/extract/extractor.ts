import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type {
  ConversionAction,
  EvidenceItem,
  ExtractionCoverage,
  LayoutFact,
  PageEvidence,
} from '../schemas/evidence.js';
import type { PageType } from '../schemas/common.js';
import type { FetchedPage } from '../crawl/types.js';
import { cleanText, stripNonVisible } from './sanitize.js';
import { classifyIntent } from './intent.js';

export const EXTRACTOR_VERSION = 'ext-v1';

export interface ExtractInput {
  pageIndex: number;
  page: FetchedPage;
  pageType: PageType;
  selectionReason: string;
}

/** Mints stable, unique refs of the documented form `page_2.hero.cta_1` (ADR-009). */
class RefMinter {
  private counters = new Map<string, number>();
  constructor(private readonly pageId: string) {}
  next(path: string): string {
    const n = (this.counters.get(path) ?? 0) + 1;
    this.counters.set(path, n);
    return `${this.pageId}.${path}_${n}`;
  }
  fixed(path: string): string {
    return `${this.pageId}.${path}`;
  }
}

const TESTIMONIAL_HINT = /(testimonial|review|quote|udtalelse|anmeldelse|kundeudtalelse|kunde-citat)/i;
const CASE_HINT = /(case|case-study|customer-story|kundecase|reference|referenc)/i;
const RATING_HINT = /(trustpilot|rating|stars|g2|capterra|anmeldelser|score)/i;
const CERT_HINT = /(iso|certified|certificering|gdpr|soc ?2|award|godkendt|member of|autoriseret)/i;
const CONTACT_HINT = /(tel:|mailto:|\+\d[\d\s]{6,}|@[a-z0-9.-]+\.[a-z]{2,})/i;
const COMPANY_HINT = /(cvr|vat|reg\.?\s?no|company (number|reg)|ust-idnr|org\.?nr|siret)/i;

export function extractPage(input: ExtractInput): PageEvidence {
  const { pageIndex, page, pageType, selectionReason } = input;
  const pageId = `page_${pageIndex}`;
  const ref = new RefMinter(pageId);
  const warnings: string[] = [];

  const $ = cheerio.load(page.html);
  const rawTitle = cleanText($('title').first().text(), 200);
  const metaDescription = cleanText($('meta[name="description"]').attr('content'), 320);
  const language = ($('html').attr('lang') ?? '').split('-')[0]?.toLowerCase() || undefined;
  stripNonVisible($);

  const headerScope = pickScope($, ['header', '[role="banner"]', '.site-header', '#header']);
  const footerScope = pickScope($, ['footer', '[role="contentinfo"]', '.site-footer', '#footer']);
  const mainScope = pickScope($, ['main', '[role="main"]', '#main', '#content']) ?? $('body');

  // --- hero ---------------------------------------------------------------
  const heroScope = pickHeroScope($, mainScope);
  const h1 = heroScope.find('h1').first().length ? heroScope.find('h1').first() : $('h1').first();
  const headlineText = cleanText(h1.text(), 240);
  const headline: EvidenceItem | undefined = headlineText
    ? { ref: ref.fixed('hero.headline'), text: headlineText }
    : undefined;
  if (!headline) warnings.push('no_h1_found');

  const subText = cleanText(nearestParagraph(h1, heroScope), 320);
  const subheadline: EvidenceItem | undefined = subText
    ? { ref: ref.fixed('hero.subheadline'), text: subText }
    : undefined;

  const heroActions = collectActions($, heroScope, ref, 'hero.cta', 'hero').slice(0, 6);
  const heroCtas: EvidenceItem[] = heroActions.map((a) => ({ ref: a.ref, text: a.label, href: a.href }));

  // --- header -------------------------------------------------------------
  const navItems: EvidenceItem[] = [];
  (headerScope ?? $('nav').first()).find('a').each((_, el) => {
    const text = cleanText($(el).text(), 60);
    if (!text || navItems.length >= 20) return;
    navItems.push({ ref: ref.next('header.nav'), text, href: $(el).attr('href') });
  });
  const headerActions = headerScope ? collectActions($, headerScope, ref, 'header.cta', 'header') : [];
  const primaryCta = headerActions.find((a) => a.intent !== 'navigate' && a.intent !== 'unknown');
  const contactLink = headerScope
    ?.find('a[href^="tel:"], a[href^="mailto:"]')
    .first();
  const contactAffordance: EvidenceItem | undefined =
    contactLink && contactLink.length
      ? { ref: ref.fixed('header.contact'), text: cleanText(contactLink.text(), 80) || (contactLink.attr('href') ?? ''), href: contactLink.attr('href') }
      : undefined;

  // --- footer -------------------------------------------------------------
  const footerContact: EvidenceItem[] = [];
  const footerCompany: EvidenceItem[] = [];
  const footerLegal: EvidenceItem[] = [];
  if (footerScope) {
    footerScope.find('a, p, span, li').each((_, el) => {
      const text = cleanText($(el).text(), 160);
      if (!text) return;
      const href = $(el).attr('href');
      if (footerContact.length < 8 && (CONTACT_HINT.test(text) || CONTACT_HINT.test(href ?? ''))) {
        footerContact.push({ ref: ref.next('footer.contact'), text, href });
      } else if (footerCompany.length < 5 && COMPANY_HINT.test(text)) {
        footerCompany.push({ ref: ref.next('footer.company'), text });
      } else if (footerLegal.length < 6 && /(privacy|terms|cookie|betingelser|persondata|impressum)/i.test(text)) {
        footerLegal.push({ ref: ref.next('footer.legal'), text, href });
      }
    });
  }
  const footerActions = footerScope ? collectActions($, footerScope, ref, 'footer.cta', 'footer') : [];

  // --- headings + sections ------------------------------------------------
  const headings: EvidenceItem[] = [];
  mainScope.find('h2, h3').each((_, el) => {
    const text = cleanText($(el).text(), 180);
    if (text && headings.length < 25) headings.push({ ref: ref.next('heading'), text });
  });

  const sections: EvidenceItem[] = [];
  mainScope.find('section, article, div.section, .container > div').each((_, el) => {
    if (sections.length >= 12) return;
    const text = cleanText($(el).text(), 700);
    if (text.length < 120) return;
    if (sections.some((s) => text.startsWith(s.text.slice(0, 80)))) return;
    sections.push({ ref: ref.next('section'), text });
  });
  if (sections.length === 0) {
    const bodyText = cleanText(mainScope.text(), 2000);
    if (bodyText) sections.push({ ref: ref.next('section'), text: bodyText });
  }

  // --- trust --------------------------------------------------------------
  const trust = {
    testimonials: collectHinted($, ref, 'trust.testimonial', TESTIMONIAL_HINT, 'blockquote, [class*="testimonial"], [class*="review"], [class*="udtalelse"]'),
    logos: collectLogos($, ref),
    caseStudies: collectHinted($, ref, 'trust.case', CASE_HINT, '[class*="case"], [class*="customer-story"], a[href*="case"]'),
    ratings: collectHinted($, ref, 'trust.rating', RATING_HINT, '[class*="rating"], [class*="trustpilot"], [class*="stars"]'),
    certifications: collectHinted($, ref, 'trust.certification', CERT_HINT, '[class*="cert"], [class*="badge"], [class*="award"]'),
  };

  // --- conversion actions -------------------------------------------------
  const bodyActions = collectActions($, mainScope, ref, 'action', 'body');
  const forms = collectForms($, ref);
  const conversionActions: ConversionAction[] = dedupeActions([
    ...headerActions,
    ...heroActions,
    ...bodyActions,
    ...footerActions,
    ...forms,
  ]).slice(0, 40);

  // --- layout -------------------------------------------------------------
  const layoutFacts: LayoutFact[] = [];
  if (page.layout) {
    for (const item of [headline, subheadline].filter(Boolean) as EvidenceItem[]) {
      const match = page.layout.elements.find((e) => e.text && item.text.startsWith(e.text.slice(0, 40)));
      if (match) {
        layoutFacts.push({
          ref: item.ref,
          aboveFold: match.aboveFold,
          fontSizePx: match.fontSizePx,
          boundsPx: { x: match.x, y: match.y, w: match.w, h: match.h },
        });
      }
    }
    for (const action of conversionActions) {
      const match = page.layout.elements.find((e) => e.text && action.label && e.text.includes(action.label.slice(0, 24)));
      if (match) {
        layoutFacts.push({
          ref: action.ref,
          aboveFold: match.aboveFold,
          fontSizePx: match.fontSizePx,
          boundsPx: { x: match.x, y: match.y, w: match.w, h: match.h },
        });
      }
    }
  }

  const coverage: ExtractionCoverage = {
    hero: headline ? (subheadline || heroCtas.length ? 'complete' : 'partial') : 'missing',
    header: headerScope ? (navItems.length ? 'complete' : 'partial') : 'missing',
    footer: footerScope ? 'complete' : 'missing',
    // Trust coverage describes whether we could reliably LOOK, not whether we found something.
    trust: sections.length > 0 ? 'complete' : 'partial',
    conversionActions: conversionActions.length > 0 ? 'complete' : mainScope.find('a,button').length ? 'complete' : 'partial',
    bodyText: sections.length > 0 ? 'complete' : 'missing',
    layout: page.layout ? 'complete' : 'missing',
  };

  return {
    pageId,
    url: page.finalUrl,
    pageType,
    selectionReason,
    title: rawTitle || undefined,
    metaDescription: metaDescription || undefined,
    language,
    httpStatus: page.status,
    hero: { headline, subheadline, ctas: heroCtas },
    header: { navItems, primaryCta: primaryCta ? { ref: primaryCta.ref, text: primaryCta.label, href: primaryCta.href } : undefined, contactAffordance },
    footer: { contact: footerContact, company: footerCompany, legal: footerLegal, ctas: footerActions.map((a) => ({ ref: a.ref, text: a.label, href: a.href })) },
    headings,
    sections,
    trust,
    conversionActions,
    layoutFacts,
    screenshotRef: page.screenshotBase64 ? `${pageId}.screenshot` : undefined,
    coverage,
    warnings,
  };
}

// --- helpers ---------------------------------------------------------------

function pickScope($: CheerioAPI, selectors: string[]): Cheerio<AnyNode> | null {
  for (const selector of selectors) {
    const found = $(selector).first();
    if (found.length) return found as unknown as Cheerio<AnyNode>;
  }
  return null;
}

/** The hero is the section containing the first H1, falling back to the top of main. */
function pickHeroScope($: CheerioAPI, mainScope: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const h1 = $('h1').first();
  if (h1.length) {
    const section = h1.closest('section, header, div[class*="hero"], div[class*="banner"], div');
    if (section.length) return section as unknown as Cheerio<AnyNode>;
  }
  return mainScope;
}

function nearestParagraph(h1: Cheerio<AnyNode>, scope: Cheerio<AnyNode>): string {
  const next = h1.nextAll('p, h2, div').first().text();
  if (next && next.trim().length > 20) return next;
  return scope.find('p').first().text();
}

function collectActions(
  $: CheerioAPI,
  scope: Cheerio<AnyNode>,
  ref: RefMinter,
  path: string,
  placement: ConversionAction['placement'],
): ConversionAction[] {
  const actions: ConversionAction[] = [];
  scope.find('a[href], button, [role="button"]').each((_, el) => {
    if (actions.length >= 25) return;
    const label = cleanText($(el).text(), 80);
    const href = $(el).attr('href');
    if (!label && !href) return;
    if (!label) return;
    const intent = classifyIntent(label, href);
    if (intent === 'navigate' && placement === 'body') return; // body nav links are not conversion actions
    actions.push({
      ref: ref.next(path),
      label,
      href,
      kind: el.tagName?.toLowerCase() === 'button' ? 'button' : 'link',
      intent,
      placement,
    });
  });
  return actions;
}

function collectForms($: CheerioAPI, ref: RefMinter): ConversionAction[] {
  const forms: ConversionAction[] = [];
  $('form').each((_, el) => {
    if (forms.length >= 6) return;
    const fields = $(el).find('input:not([type="hidden"]):not([type="submit"]), textarea, select').length;
    const submitLabel =
      cleanText($(el).find('button, input[type="submit"]').first().text(), 60) ||
      cleanText($(el).find('input[type="submit"]').attr('value'), 60) ||
      'form submit';
    // Search boxes are not conversion actions.
    if (/search|s(o|ø)g/i.test(($(el).attr('class') ?? '') + ($(el).attr('id') ?? '') + submitLabel)) return;
    forms.push({
      ref: ref.next('form'),
      label: submitLabel,
      href: $(el).attr('action'),
      kind: 'form',
      intent: classifyIntent(submitLabel, $(el).attr('action')),
      placement: 'form',
      fieldCount: fields,
    });
  });
  return forms;
}

function collectHinted(
  $: CheerioAPI,
  ref: RefMinter,
  path: string,
  hint: RegExp,
  selector: string,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    if (items.length >= 8) return;
    const text = cleanText($(el).text(), 320);
    const attrs = `${$(el).attr('class') ?? ''} ${$(el).attr('href') ?? ''}`;
    if (!text || text.length < 12) return;
    if (!hint.test(text) && !hint.test(attrs)) return;
    const key = text.slice(0, 60);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ ref: ref.next(path), text, href: $(el).attr('href') });
  });
  return items;
}

function collectLogos($: CheerioAPI, ref: RefMinter): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  $('[class*="logo"] img, [class*="client"] img, [class*="partner"] img, [class*="kunde"] img').each((_, el) => {
    if (items.length >= 12) return;
    const alt = cleanText($(el).attr('alt'), 80);
    if (!alt) return;
    if (/^(logo|icon|image)$/i.test(alt)) return;
    items.push({ ref: ref.next('trust.logo'), text: alt });
  });
  return items;
}

function dedupeActions(actions: ConversionAction[]): ConversionAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.placement}|${action.label.toLowerCase()}|${action.href ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

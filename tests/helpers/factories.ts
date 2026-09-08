import type { PageEvidence, PerformanceMeasurement, WebsiteEvidence } from '../../src/core/schemas/evidence.js';
import type { SiteContext } from '../../src/core/schemas/context.js';
import type { SignalAssessment } from '../../src/core/schemas/signals.js';
import { CONSISTENCY_CATEGORIES, DASHBOARD_CATEGORIES } from '../../src/core/scoring/rubric.v1.js';

export interface EvidenceOptions {
  pageCount?: number;
  withActions?: boolean;
  coverage?: 'complete' | 'partial';
  goalPageActionIntent?: string;
  performance?: PerformanceMeasurement[];
}

function makePage(index: number, options: EvidenceOptions): PageEvidence {
  const pageId = `page_${index}`;
  const coverage = options.coverage ?? 'complete';
  const withActions = options.withActions !== false;
  const intent = index === 2 && options.goalPageActionIntent ? options.goalPageActionIntent : 'contact';
  return {
    pageId,
    url: `https://www.example.com/${index === 1 ? '' : `p${index}`}`,
    pageType: index === 1 ? 'homepage' : 'product_service',
    selectionReason: 'test fixture page',
    title: `Page ${index}`,
    language: 'en',
    hero: {
      headline: { ref: `${pageId}.hero.headline`, text: 'A specific offer headline' },
      subheadline: { ref: `${pageId}.hero.subheadline`, text: 'A supporting sentence about the buyer.' },
      ctas: withActions ? [{ ref: `${pageId}.hero.cta_1`, text: 'Contact us' }] : [],
    },
    header: {
      navItems: [{ ref: `${pageId}.header.nav_1`, text: 'Services' }],
      primaryCta: withActions ? { ref: `${pageId}.header.cta_1`, text: 'Contact us' } : undefined,
      contactAffordance: { ref: `${pageId}.header.contact`, text: 'hello@example.com' },
    },
    footer: {
      contact: [{ ref: `${pageId}.footer.contact_1`, text: 'hello@example.com' }],
      company: [],
      legal: [],
      ctas: [],
    },
    headings: [{ ref: `${pageId}.heading_1`, text: 'What we do' }],
    sections: [{ ref: `${pageId}.section_1`, text: 'A section of body copy long enough to matter.' }],
    trust: { testimonials: [], logos: [], caseStudies: [], ratings: [], certifications: [] },
    conversionActions: withActions
      ? [{ ref: `${pageId}.action_1`, label: 'Contact us', kind: 'link', intent: intent as any, placement: 'hero' }]
      : [],
    layoutFacts: [],
    coverage: {
      hero: coverage,
      header: coverage,
      footer: coverage,
      trust: coverage,
      conversionActions: coverage,
      bodyText: coverage,
      layout: 'missing',
    },
    warnings: [],
  };
}

export function makeEvidence(options: EvidenceOptions = {}): WebsiteEvidence {
  const pageCount = options.pageCount ?? 3;
  return {
    schemaVersion: 'evidence-v1',
    analysisId: 'a',
    extractorVersion: 'ext-v1',
    domain: 'example.com',
    rootUrl: 'https://www.example.com',
    capturedAt: '2026-09-04T00:00:00.000Z',
    pages: Array.from({ length: pageCount }, (_, i) => makePage(i + 1, options)),
    failedPages: [],
    performance: options.performance ?? [],
    crawlStats: { requests: pageCount, bytes: 1000, candidatesConsidered: 10 },
  };
}

export function makeContext(options: { goal?: string; goalPageId?: string | null } = {}): SiteContext {
  return {
    schemaVersion: 'sitecontext-v1',
    analysisId: 'a',
    siteArchetype: { value: 'professional_services', confidence: 'high', evidenceRefs: ['page_1.hero.headline'] },
    primaryConversionGoal: { value: (options.goal ?? 'contact') as any, confidence: 'high', evidenceRefs: ['page_1.hero.cta_1'] },
    primaryICP: { value: 'Operations leaders at mid-sized manufacturers', confidence: 'medium', evidenceRefs: ['page_1.hero.subheadline'] },
    secondaryICP: null,
    dominantLanguage: 'en',
    unsupportedArchetype: false,
    primaryConversionPageId: options.goalPageId === undefined ? null : (options.goalPageId as any),
    reportLanguage: 'en',
    reportLanguageSource: 'detected',
  };
}

/** Every rubric signal set to the same value — the baseline for arithmetic assertions. */
export function allSignals(value: 0 | 1 | 2 | 3 | 4): SignalAssessment[] {
  return [...DASHBOARD_CATEGORIES, ...CONSISTENCY_CATEGORIES].flatMap((category) =>
    category.signals.map((signal) => ({
      signalId: signal.signalId,
      value,
      evidenceRefs: ['page_1.hero.headline'],
      confidence: 'high' as const,
      rationale: 'test',
    })),
  );
}

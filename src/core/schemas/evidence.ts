import { z } from 'zod';
import { EvidenceRef, PageId, PageType } from './common.js';

/** A citable snippet. `ref` is what findings point at; `text` is untrusted website data. */
export const EvidenceItem = z.object({
  ref: EvidenceRef,
  text: z.string(),
  href: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** Deterministic layout facts, only present when a rendering adapter supplied them (build spec §11). */
export const LayoutFact = z.object({
  ref: EvidenceRef,
  aboveFold: z.boolean().optional(),
  fontSizePx: z.number().optional(),
  boundsPx: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});
export type LayoutFact = z.infer<typeof LayoutFact>;

export const ConversionAction = z.object({
  ref: EvidenceRef,
  label: z.string(),
  href: z.string().optional(),
  kind: z.enum(['link', 'button', 'form']),
  /** Inferred from label/destination by deterministic rules, not by a model. */
  intent: z.enum([
    'demo',
    'contact',
    'quote',
    'trial',
    'signup',
    'call',
    'booking',
    'download',
    'navigate',
    'unknown',
  ]),
  placement: z.enum(['header', 'hero', 'body', 'footer', 'form']),
  fieldCount: z.number().int().nonnegative().optional(),
});
export type ConversionAction = z.infer<typeof ConversionAction>;

/**
 * Which element classes were reliably observed. Absence may only be asserted where coverage is
 * `complete` (reasoning spec §1/§4, ADR-010).
 */
export const CoverageState = z.enum(['complete', 'partial', 'missing']);
export const ExtractionCoverage = z.object({
  hero: CoverageState,
  header: CoverageState,
  footer: CoverageState,
  trust: CoverageState,
  conversionActions: CoverageState,
  bodyText: CoverageState,
  layout: CoverageState,
});
export type ExtractionCoverage = z.infer<typeof ExtractionCoverage>;

export const PageEvidence = z.object({
  pageId: PageId,
  url: z.string().url(),
  pageType: PageType,
  selectionReason: z.string(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  language: z.string().optional(),
  httpStatus: z.number().int().optional(),
  hero: z.object({
    headline: EvidenceItem.optional(),
    subheadline: EvidenceItem.optional(),
    ctas: z.array(EvidenceItem),
  }),
  header: z.object({
    navItems: z.array(EvidenceItem),
    primaryCta: EvidenceItem.optional(),
    contactAffordance: EvidenceItem.optional(),
  }),
  footer: z.object({
    contact: z.array(EvidenceItem),
    company: z.array(EvidenceItem),
    legal: z.array(EvidenceItem),
    ctas: z.array(EvidenceItem),
  }),
  headings: z.array(EvidenceItem),
  sections: z.array(EvidenceItem),
  trust: z.object({
    testimonials: z.array(EvidenceItem),
    logos: z.array(EvidenceItem),
    caseStudies: z.array(EvidenceItem),
    ratings: z.array(EvidenceItem),
    certifications: z.array(EvidenceItem),
  }),
  conversionActions: z.array(ConversionAction),
  layoutFacts: z.array(LayoutFact),
  screenshotRef: z.string().optional(),
  coverage: ExtractionCoverage,
  warnings: z.array(z.string()),
});
export type PageEvidence = z.infer<typeof PageEvidence>;

export const PerformanceMeasurement = z.object({
  pageId: PageId,
  source: z.string(),
  measuredAt: z.string(),
  strategy: z.enum(['mobile', 'desktop']),
  lcpMs: z.number().optional(),
  clsScore: z.number().optional(),
  tbtMs: z.number().optional(),
  inpMs: z.number().optional(),
  ttfbMs: z.number().optional(),
});
export type PerformanceMeasurement = z.infer<typeof PerformanceMeasurement>;

export const FailedPage = z.object({
  url: z.string(),
  reason: z.string(),
});

export const WebsiteEvidence = z.object({
  schemaVersion: z.literal('evidence-v1'),
  analysisId: z.string(),
  extractorVersion: z.string(),
  domain: z.string(),
  rootUrl: z.string().url(),
  capturedAt: z.string(),
  pages: z.array(PageEvidence),
  /** Pages we attempted and failed. Never cited or evaluated as analyzed (reasoning spec §16). */
  failedPages: z.array(FailedPage),
  performance: z.array(PerformanceMeasurement),
  crawlStats: z.object({
    requests: z.number().int(),
    bytes: z.number().int(),
    candidatesConsidered: z.number().int(),
  }),
});
export type WebsiteEvidence = z.infer<typeof WebsiteEvidence>;

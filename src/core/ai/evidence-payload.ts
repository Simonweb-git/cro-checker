import type { WebsiteEvidence, PageEvidence } from '../schemas/evidence.js';

/**
 * The set of refs a model is allowed to cite. Anything else is invented and gets dropped (ADR-009).
 */
export function buildRefRegistry(evidence: WebsiteEvidence): Set<string> {
  const refs = new Set<string>();
  for (const page of evidence.pages) {
    const add = (ref?: string) => {
      if (ref) refs.add(ref);
    };
    add(page.hero.headline?.ref);
    add(page.hero.subheadline?.ref);
    page.hero.ctas.forEach((c) => add(c.ref));
    page.header.navItems.forEach((n) => add(n.ref));
    add(page.header.primaryCta?.ref);
    add(page.header.contactAffordance?.ref);
    [...page.footer.contact, ...page.footer.company, ...page.footer.legal, ...page.footer.ctas].forEach((i) => add(i.ref));
    page.headings.forEach((h) => add(h.ref));
    page.sections.forEach((s) => add(s.ref));
    Object.values(page.trust).flat().forEach((t) => add(t.ref));
    page.conversionActions.forEach((a) => add(a.ref));
    page.layoutFacts.forEach((l) => add(l.ref));
  }
  return refs;
}

/** Compact projection sent to models. Raw HTML never appears (build spec §10). */
export function pagePayload(page: PageEvidence) {
  return {
    pageId: page.pageId,
    url: page.url,
    pageType: page.pageType,
    title: page.title,
    metaDescription: page.metaDescription,
    language: page.language,
    hero: {
      headline: page.hero.headline,
      subheadline: page.hero.subheadline,
      ctas: page.hero.ctas,
    },
    header: {
      navItems: page.header.navItems.map((n) => ({ ref: n.ref, text: n.text })),
      primaryCta: page.header.primaryCta,
      contactAffordance: page.header.contactAffordance,
    },
    footer: {
      contact: page.footer.contact,
      company: page.footer.company,
      ctas: page.footer.ctas,
    },
    headings: page.headings,
    sections: page.sections.map((s) => ({ ref: s.ref, text: s.text.slice(0, 600) })),
    trust: page.trust,
    conversionActions: page.conversionActions.map((a) => ({
      ref: a.ref,
      label: a.label,
      intent: a.intent,
      placement: a.placement,
      kind: a.kind,
      fieldCount: a.fieldCount,
    })),
    layoutFacts: page.layoutFacts,
    extractionCoverage: page.coverage,
    extractionWarnings: page.warnings,
  };
}

export function evidencePayload(evidence: WebsiteEvidence) {
  return {
    domain: evidence.domain,
    rootUrl: evidence.rootUrl,
    analysedPages: evidence.pages.map(pagePayload),
    pagesThatFailedExtraction: evidence.failedPages,
    performanceMeasurements: evidence.performance,
    note: 'A missing extraction is not evidence that an element is missing from the website.',
  };
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/core/extract/extractor.js';
import { classifyIntent } from '../src/core/extract/intent.js';
import { EvidenceRef, PageEvidence } from '../src/core/schemas/index.js';

function extractFixture(file: string, pageIndex = 1, pageType: any = 'homepage') {
  const html = readFileSync(file, 'utf8');
  return extractPage({
    pageIndex,
    page: { requestedUrl: 'https://www.example.com/', finalUrl: 'https://www.example.com/', status: 200, html, bytes: html.length },
    pageType,
    selectionReason: 'test',
  });
}

describe('extractor', () => {
  const page = extractFixture('tests/fixtures/sites/northwind/index.html');

  it('produces schema-valid page evidence', () => {
    expect(() => PageEvidence.parse(page)).not.toThrow();
  });

  it('extracts the hero headline, subheadline and CTAs', () => {
    expect(page.hero.headline?.text).toBe('Unlock your true growth potential');
    expect(page.hero.subheadline?.text).toContain('strategic partner');
    expect(page.hero.ctas.length).toBeGreaterThanOrEqual(3);
  });

  it('mints unique, well-formed evidence refs', () => {
    const refs = [
      page.hero.headline!.ref,
      ...page.hero.ctas.map((c) => c.ref),
      ...page.headings.map((h) => h.ref),
      ...page.conversionActions.map((a) => a.ref),
    ];
    for (const ref of refs) expect(() => EvidenceRef.parse(ref)).not.toThrow();
    // One element gets exactly one ref, so a hero CTA keeps its ref when it also appears in the
    // conversionActions list. Uniqueness is therefore asserted per collection.
    const actionRefs = page.conversionActions.map((a) => a.ref);
    expect(new Set(actionRefs).size).toBe(actionRefs.length);
    const headingRefs = page.headings.map((h) => h.ref);
    expect(new Set(headingRefs).size).toBe(headingRefs.length);
    for (const cta of page.hero.ctas) expect(actionRefs).toContain(cta.ref);
    expect(page.hero.headline!.ref).toBe('page_1.hero.headline');
  });

  it('accepts mixed-case ref path segments (regression)', () => {
    // A live failure showed a model citing "page_1.metaDescription" — a real payload field name,
    // just not a minted ref — and the old regex rejected it purely for the capital D before the
    // registry-membership check ever ran. The regex is a shape check, not the security boundary.
    expect(() => EvidenceRef.parse('page_1.metaDescription')).not.toThrow();
    expect(() => EvidenceRef.parse('page_2.url')).not.toThrow();
    expect(() => EvidenceRef.parse('page_1.hero.headline')).not.toThrow();
    expect(() => EvidenceRef.parse('not_a_ref')).toThrow();
    expect(() => EvidenceRef.parse('page_1')).toThrow();
  });

  it('classifies conversion action intent deterministically', () => {
    const intents = page.conversionActions.map((a) => a.intent);
    expect(intents).toContain('contact');
    expect(classifyIntent('Book a demo', '/demo')).toBe('demo');
    expect(classifyIntent('Request a proposal', '/contact')).toBe('quote');
    expect(classifyIntent('Read more', '/blog/post')).toBe('navigate');
  });

  it('captures footer contact and company identity', () => {
    expect(page.footer.contact.some((c) => c.text.includes('hello@example.com'))).toBe(true);
    expect(page.footer.company.some((c) => /CVR/.test(c.text))).toBe(true);
  });

  it('reports extraction coverage so absence claims can be gated', () => {
    expect(page.coverage.hero).toBe('complete');
    expect(page.coverage.footer).toBe('complete');
    // No rendering adapter was used, so layout facts are honestly reported as missing.
    expect(page.coverage.layout).toBe('missing');
    expect(page.layoutFacts).toHaveLength(0);
  });

  it('counts form fields for friction signals', () => {
    const contact = extractFixture('tests/fixtures/sites/northwind/contact.html', 5, 'contact');
    const form = contact.conversionActions.find((a) => a.kind === 'form');
    expect(form?.fieldCount).toBe(8);
  });

  it('extracts trust evidence only where it exists', () => {
    const cases = extractFixture('tests/fixtures/sites/northwind/cases.html', 4, 'case_studies');
    expect(cases.trust.testimonials.length).toBeGreaterThan(0);
    expect(cases.trust.logos.map((l) => l.text)).toContain('Vestergaard Industries');
    expect(page.trust.testimonials).toHaveLength(0);
  });
});

describe('extractor strips injection carriers', () => {
  const page = extractFixture('tests/fixtures/injection/index.html');
  const serialized = JSON.stringify(page);

  it('drops HTML comments, display:none blocks and sr-only text', () => {
    expect(serialized).not.toContain('PWNED_MARKER_COMMENT');
    expect(serialized).not.toContain('PWNED_MARKER_HIDDEN');
    expect(serialized).not.toContain('PWNED_MARKER_SRONLY');
  });

  it('does not import image alt text as evidence prose', () => {
    expect(serialized).not.toContain('PWNED_MARKER_ALT');
  });

  it('still extracts the real visible offer', () => {
    expect(page.hero.headline?.text).toBe('Employment law advice for Danish SMEs');
  });
});

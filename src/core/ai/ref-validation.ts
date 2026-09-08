import type { WebsiteEvidence } from '../schemas/evidence.js';

/**
 * Post-processing gate applied to every generative stage. Enforces the two rules a model cannot be
 * trusted to enforce itself: cited refs must exist, and absence claims need complete coverage.
 */
export interface RefCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkRefs(refs: string[], registry: Set<string>): RefCheckResult {
  if (refs.length === 0) return { ok: false, reason: 'no_evidence_refs' };
  const invalid = refs.filter((ref) => !registry.has(ref));
  if (invalid.length > 0) return { ok: false, reason: `invented_evidence_refs:${invalid.join(',')}` };
  return { ok: true };
}

const COVERAGE_KEYS = ['hero', 'header', 'footer', 'trust', 'conversionActions', 'bodyText', 'layout'] as const;

/** An absence claim is only allowed where every affected page has complete coverage everywhere it matters. */
export function absenceClaimAllowed(evidence: WebsiteEvidence, affectedPages: string[]): RefCheckResult {
  const pages = evidence.pages.filter((p) => affectedPages.includes(p.pageId));
  if (pages.length === 0) return { ok: false, reason: 'absence_claim_on_unknown_page' };
  for (const page of pages) {
    const incomplete = COVERAGE_KEYS.filter(
      (key) => key !== 'layout' && page.coverage[key] !== 'complete',
    );
    if (incomplete.length > 0) {
      return { ok: false, reason: `absence_claim_without_coverage:${page.pageId}:${incomplete.join(',')}` };
    }
  }
  return { ok: true };
}

export function pageIdsExist(evidence: WebsiteEvidence, pageIds: string[]): RefCheckResult {
  const known = new Set(evidence.pages.map((p) => p.pageId));
  const unknown = pageIds.filter((id) => !known.has(id));
  if (unknown.length > 0) return { ok: false, reason: `unknown_page_ids:${unknown.join(',')}` };
  return { ok: true };
}

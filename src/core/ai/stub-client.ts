import type { z } from 'zod';
import { EVIDENCE_CLOSE, EVIDENCE_OPEN } from './prompts.js';
import type { ModelCallOptions, ModelClient, ModelResult } from './model-client.js';

/**
 * Deterministic offline provider (ADR-006). It derives everything from the evidence that was fenced
 * into the prompt, so the full pipeline — ref validation, scoring, QA, assembly — is exercised without
 * network access. Output is always stamped commercialUse=false so it can never pass as a real report.
 *
 * This is NOT a fallback for a failed real model call. It is selected only when no keys exist at all.
 */
export class StubModelClient implements ModelClient {
  readonly modelConfigVersion = 'stub';
  readonly commercialUse = false;

  async generateStructured<T>(
    model: string,
    schema: z.ZodType<T>,
    options: ModelCallOptions,
  ): Promise<ModelResult<T>> {
    const evidence = parseEvidence(options.prompt);
    const raw = this.build(options, evidence);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `StubModelClient produced output that fails the ${options.stage} schema: ${parsed.error.message}`,
      );
    }
    return {
      data: parsed.data,
      usage: {
        stage: options.stage,
        model: `${model}:stub`,
        inputTokens: Math.ceil(options.prompt.length / 4),
        outputTokens: Math.ceil(JSON.stringify(raw).length / 4),
        estimatedCostUsd: 0,
        attempts: 1,
      },
    };
  }

  private build(options: ModelCallOptions, ev: EvidencePayload): unknown {
    if (options.stage === 'site_context') return stubSiteContext(ev);
    if (options.stage.startsWith('signals:')) return stubSignals(options.prompt, ev);
    if (options.stage === 'diagnostic') return stubDiagnostic(ev);
    if (options.stage === 'fix') return stubFixes(options.prompt, ev);
    if (options.stage === 'qa') return stubQA(options.prompt);
    if (options.stage === 'narration') return stubNarration(options.prompt, ev);
    throw new Error(`StubModelClient has no implementation for stage ${options.stage}`);
  }
}

// --- evidence access -------------------------------------------------------

interface StubPage {
  pageId: string;
  url: string;
  pageType: string;
  hero: { headline?: { ref: string; text: string }; subheadline?: { ref: string; text: string }; ctas: Array<{ ref: string; text: string }> };
  header: { navItems: Array<{ ref: string; text: string }>; primaryCta?: { ref: string; text: string }; contactAffordance?: { ref: string } };
  footer: { contact: Array<{ ref: string }>; ctas: Array<{ ref: string }> };
  headings: Array<{ ref: string; text: string }>;
  sections: Array<{ ref: string; text: string }>;
  trust: Record<string, Array<{ ref: string; text: string }>>;
  conversionActions: Array<{ ref: string; label: string; intent: string; placement: string; fieldCount?: number }>;
  extractionCoverage: Record<string, string>;
}

interface EvidencePayload {
  domain: string;
  analysedPages: StubPage[];
  performanceMeasurements: unknown[];
}

function parseEvidence(prompt: string): EvidencePayload {
  const start = prompt.indexOf(EVIDENCE_OPEN);
  const end = prompt.indexOf(EVIDENCE_CLOSE);
  if (start === -1 || end === -1) return { domain: '', analysedPages: [], performanceMeasurements: [] };
  const json = prompt.slice(start + EVIDENCE_OPEN.length, end).trim();
  try {
    return JSON.parse(json) as EvidencePayload;
  } catch {
    return { domain: '', analysedPages: [], performanceMeasurements: [] };
  }
}

const firstRef = (ev: EvidencePayload): string | null => {
  const page = ev.analysedPages[0];
  return page?.hero.headline?.ref ?? page?.headings[0]?.ref ?? page?.sections[0]?.ref ?? null;
};

const allActions = (ev: EvidencePayload) => ev.analysedPages.flatMap((p) => p.conversionActions);
const proofCount = (ev: EvidencePayload) =>
  ev.analysedPages.reduce((sum, p) => sum + Object.values(p.trust ?? {}).flat().length, 0);

/** A templated sentence built only from counted structural facts — never scraped prose. */
function summarizeIcp(ev: EvidencePayload): string {
  const pageTypes = [...new Set(ev.analysedPages.map((p) => p.pageType))].filter((t) => t !== 'homepage');
  const proof = proofCount(ev);
  const scope = pageTypes.length > 0 ? pageTypes.join(', ') : 'the homepage';
  return `A visitor evaluating this offer via ${scope}, with ${proof} proof element(s) observed across ${ev.analysedPages.length} analysed page(s).`;
}

// --- per-stage deterministic output ---------------------------------------

function stubSiteContext(ev: EvidencePayload) {
  const ref = firstRef(ev);
  const refs = ref ? [ref] : [];
  const text = ev.analysedPages
    .flatMap((p) => [p.hero.headline?.text, p.hero.subheadline?.text, ...p.headings.map((h) => h.text)])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const intents = allActions(ev).map((a) => a.intent);
  const hasPricing = ev.analysedPages.some((p) => p.pageType === 'pricing');
  const ecommerce = /(add to cart|læg i kurv|basket|checkout|free shipping|fri fragt)/.test(text);

  const archetype = ecommerce
    ? 'ecommerce_unsupported'
    : intents.includes('trial') || intents.includes('signup') || (hasPricing && /platform|software|saas/.test(text))
      ? 'b2b_saas'
      : /(agency|bureau|advisory|consultancy)/.test(text)
        ? 'agency_advisory'
        : /(local|clinic|klinik|salon|garage|visit us)/.test(text)
          ? 'local_leadgen'
          : 'professional_services';

  const goal = intents.includes('demo')
    ? 'book_demo'
    : intents.includes('trial')
      ? 'start_trial'
      : intents.includes('quote')
        ? 'request_quote'
        : intents.includes('booking')
          ? 'schedule_call'
          : 'contact';

  const goalPage =
    ev.analysedPages.find((p) => p.conversionActions.some((a) => a.intent === goal.replace('book_', '').replace('start_', '').replace('request_', '')))?.pageId ??
    ev.analysedPages.find((p) => ['demo_booking', 'contact'].includes(p.pageType))?.pageId ??
    null;

  return {
    siteArchetype: { value: archetype, confidence: 'low', evidenceRefs: refs },
    primaryConversionGoal: { value: goal, confidence: 'low', evidenceRefs: refs },
    // Synthesized from structural facts only — never a verbatim quote of scraped text. Evidence is
    // DATA (build spec §8): even visible copy can carry an injection payload, and a real diagnostic
    // model paraphrases rather than echoes, so the offline provider must not behave differently.
    primaryICP: {
      value: refs.length > 0 ? summarizeIcp(ev) : 'Not determinable from the offline provider.',
      confidence: 'low',
      evidenceRefs: refs,
    },
    secondaryICP: null,
    dominantLanguage: null,
    unsupportedArchetype: archetype === 'ecommerce_unsupported',
    primaryConversionPageId: goalPage,
    notes: 'Generated by the deterministic offline provider; not a commercial-grade inference.',
  };
}

function requestedSignals(prompt: string): Array<{ id: string; inverted: boolean }> {
  return prompt
    .split('\n')
    .filter((line) => line.startsWith('- ') && line.includes(':'))
    .map((line) => {
      const id = line.slice(2).split(/[:\s\[]/)[0] ?? '';
      return { id, inverted: line.includes('[INVERTED') };
    })
    .filter((s) => s.id.length > 0);
}

function stubSignals(prompt: string, ev: EvidencePayload) {
  const pages = ev.analysedPages;
  const ref = firstRef(ev);
  const refs = ref ? [ref] : [];
  const actions = allActions(ev);
  const proof = proofCount(ev);
  const hasHeadline = Boolean(pages[0]?.hero.headline?.text);
  const realActions = actions.filter((a) => a.intent !== 'navigate' && a.intent !== 'unknown');

  // Crude but deterministic: derived only from counted evidence, never from language understanding.
  const heuristic: Record<string, number> = {
    offer_clarity: hasHeadline ? 2 : 0,
    audience_recognizability: pages[0]?.hero.subheadline ? 2 : 1,
    outcome_specificity: 2,
    differentiation_visibility: 1,
    messaging_fit_to_buyer: 2,
    proof_fit_to_buyer: proof > 0 ? 2 : 1,
    cta_fit_to_buying_stage: realActions.length > 0 ? 2 : 0,
    primary_action_clarity: pages[0]?.header.primaryCta ? 3 : realActions.length ? 2 : 0,
    cta_intent_fit: realActions.length ? 2 : 0,
    competing_cta_ambiguity: realActions.length > 6 ? 1 : 3,
    conversion_path_coherence: pages.length >= 2 ? 2 : 1,
    proof_presence_at_decision_points: proof >= 3 ? 3 : proof > 0 ? 2 : 0,
    proof_adequacy_for_risk: proof >= 3 ? 2 : 1,
    identity_verifiability: pages.some((p) => p.footer.contact.length > 0 || p.header.contactAffordance) ? 3 : 1,
    claim_substantiation: 2,
    path_comprehensibility: (pages[0]?.header.navItems.length ?? 0) > 0 ? 3 : 1,
    goal_supportiveness: pages[0]?.header.primaryCta ? 3 : 2,
    key_page_discoverability: (pages[0]?.header.navItems.length ?? 0) >= 3 ? 3 : 2,
    hero_focus: (pages[0]?.hero.ctas.length ?? 0) <= 2 ? 3 : 1,
    time_to_value_comprehension: hasHeadline ? 2 : 1,
    distraction_load: 2,
    action_friction: actions.some((a) => (a.fieldCount ?? 0) > 6) ? 1 : 3,
    core_offer_reinforcement: 2,
    value_prop_contradiction_absence: 3,
    buyer_compatibility: 2,
    progression_coherence: 2,
    cross_page_intent_appropriateness: 2,
    proof_at_commitment_stages: proof > 0 ? 2 : 1,
  };

  return {
    assessments: requestedSignals(prompt).map((signal) => ({
      signalId: signal.id,
      value: refs.length === 0 ? 'insufficient_evidence' : (heuristic[signal.id] ?? 2),
      evidenceRefs: refs,
      confidence: 'low',
      rationale: 'Offline provider: value derived from counted extraction facts, not semantic judgement.',
    })),
  };
}

function stubDiagnostic(ev: EvidencePayload) {
  const findings: unknown[] = [];
  const page = ev.analysedPages[0];
  if (!page) return { findings };
  const actions = allActions(ev).filter((a) => a.intent !== 'navigate' && a.intent !== 'unknown');
  const coverageComplete = ev.analysedPages.every((p) => p.extractionCoverage?.conversionActions === 'complete');

  if (actions.length === 0 && coverageComplete && page.hero.headline) {
    findings.push({
      findingId: 'f_no_conversion_action',
      title: 'No clear conversion action was detected on the analysed pages',
      severity: 'CRITICAL',
      expectedImpact: 'High',
      affectedPages: ev.analysedPages.map((p) => p.pageId),
      evidenceRefs: [page.hero.headline.ref],
      observedFact: 'Extraction with complete coverage found no call to action that maps to a conversion intent.',
      croInference: 'Visitors who are ready to act have no obvious next step.',
      whyItHurts: 'Interest generated by the page cannot convert into a contactable lead.',
      recommendedDirection: 'Place one primary action, matching the main conversion goal, in the hero and header.',
      confidence: 'medium',
      assertsAbsence: true,
    });
  }
  if (proofCount(ev) === 0 && page.hero.headline) {
    findings.push({
      findingId: 'f_thin_proof',
      title: 'No customer proof was found on the analysed pages',
      severity: 'HIGH',
      expectedImpact: 'Medium',
      affectedPages: [page.pageId],
      evidenceRefs: [page.hero.headline.ref],
      observedFact: 'No testimonials, case references, customer logos or ratings were extracted.',
      croInference: 'A considering buyer has nothing external to validate the claims with.',
      whyItHurts: 'Trust has to be built entirely from self-description, which slows or stops decisions.',
      recommendedDirection: 'Surface existing proof at the decision points where commitment increases.',
      confidence: 'low',
      assertsAbsence: false,
    });
  }
  if (findings.length === 0 && page.hero.headline) {
    findings.push({
      findingId: 'f_offline_baseline',
      title: 'Offline analysis produced no high-confidence problem',
      severity: 'LOW',
      expectedImpact: 'Low',
      affectedPages: [page.pageId],
      evidenceRefs: [page.hero.headline.ref],
      observedFact: 'The offline provider only counts extraction facts and found no rule violation.',
      croInference: 'No conclusion about messaging quality can be drawn without a real reasoning model.',
      whyItHurts: 'Running without model access produces a structurally valid but commercially thin report.',
      recommendedDirection: 'Configure a model provider and re-run to obtain a commercial-grade diagnosis.',
      confidence: 'low',
      assertsAbsence: false,
    });
  }
  return { findings };
}

function stubFixes(prompt: string, ev: EvidencePayload) {
  const page = ev.analysedPages[0];
  if (!page) return { fixes: [] };
  const findingIds = [...prompt.matchAll(/"findingId":"(f_[a-z0-9_]+)"/g)].map((m) => m[1]!);
  const ref = firstRef(ev);
  if (!ref) return { fixes: [] };
  return {
    fixes: findingIds.map((findingId, index) => ({
      kind: 'structural',
      fixId: `fx_${index + 1}_${findingId.slice(2)}`,
      findingId,
      pageId: page.pageId,
      placement: 'Primary above-the-fold area',
      currentIssue: 'See the linked finding.',
      whatToChange: 'Apply the recommended direction from the finding.',
      rationale: 'The offline provider does not write replacement copy, because it cannot verify the offer.',
      evidenceRefs: [ref],
      recommendation:
        'Structural recommendation only: configure a model provider to generate grounded replacement copy.',
    })),
  };
}

function stubQA(prompt: string) {
  const findingIds = [...prompt.matchAll(/"findingId":"(f_[a-z0-9_]+)"/g)].map((m) => m[1]!);
  const fixIds = [...prompt.matchAll(/"fixId":"(fx_[a-z0-9_]+)"/g)].map((m) => m[1]!);
  return {
    results: [
      ...new Set(findingIds),
    ].map((id) => ({
      itemId: id,
      itemType: 'finding',
      verdict: 'PASS',
      reason: 'Offline provider: refs and coverage were already enforced by the engine.',
      revisionInstruction: null,
    })).concat(
      [...new Set(fixIds)].map((id) => ({
        itemId: id,
        itemType: 'fix' as const,
        verdict: 'PASS' as const,
        reason: 'Offline provider: structural fix contains no factual claims to verify.',
        revisionInstruction: null,
      })) as never[],
    ),
  };
}

function stubNarration(prompt: string, ev: EvidencePayload) {
  const categoryIds = [...prompt.matchAll(/"categoryId":"([a-z_]+)"/g)].map((m) => m[1]!);
  const ref = firstRef(ev);
  return {
    executiveSummary:
      'This report was produced by the deterministic offline provider. Scores are rubric-calculated from extraction facts only, and the narrative is templated. Configure a model provider for a commercial-grade analysis.',
    narrations: [...new Set(categoryIds)].map((categoryId) => ({
      categoryId,
      status: 'available',
      primaryReason: 'Score calculated by the engine rubric from the extracted evidence.',
      biggestImprovementOpportunity: 'Re-run with a configured model provider for a substantive assessment.',
      supportingEvidenceRefs: ref ? [ref] : [],
    })),
    consistencyAnalysis: 'Cross-page consistency was scored from counted evidence only in offline mode.',
    trustReview: 'Trust signals were counted, not judged, in offline mode.',
    performanceImpact:
      ev.performanceMeasurements.length > 0
        ? 'Performance was measured and scored by the engine.'
        : 'No performance measurement was available, so this category is unavailable.',
  };
}

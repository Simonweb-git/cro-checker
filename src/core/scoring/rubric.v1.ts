import { createHash } from 'node:crypto';

/**
 * Executable copy of docs/SCORING.md. Any change here REQUIRES a scoringVersion bump —
 * enforced by tests/scoring-rubric.test.ts (ADR-014).
 */
export const SCORING_VERSION = 'croh-v1';

export interface SignalDefinition {
  signalId: string;
  weight: number;
  /** Prompt-facing definition of the single thing this signal measures. */
  definition: string;
  /** True when 4 means "little of the bad thing" (e.g. friction, ambiguity). */
  inverted?: boolean;
  /** Signal cannot be judged without these preconditions. */
  requires?: 'multi_page' | 'layout_evidence';
}

export interface CategoryDefinition {
  categoryId: string;
  label: string;
  weight: number;
  kind: 'dashboard' | 'consistency';
  /** Objective categories are computed from measurements; no model involvement. */
  objective?: boolean;
  signals: SignalDefinition[];
}

export const DASHBOARD_CATEGORIES: CategoryDefinition[] = [
  {
    categoryId: 'messaging_clarity',
    label: 'Messaging Clarity',
    weight: 0.2,
    kind: 'dashboard',
    signals: [
      { signalId: 'offer_clarity', weight: 0.35, definition: 'Can a relevant visitor quickly understand what is offered? Judge the combined hero, not one headline in isolation.' },
      { signalId: 'audience_recognizability', weight: 0.25, definition: 'Is the intended buyer or the problem they have recognisable from the page?' },
      { signalId: 'outcome_specificity', weight: 0.25, definition: 'Is the value or outcome specific enough to matter to that buyer, rather than generic?' },
      { signalId: 'differentiation_visibility', weight: 0.15, definition: 'Is a reason to choose this company over an alternative visible where the archetype makes that relevant?' },
    ],
  },
  {
    categoryId: 'icp_alignment',
    label: 'ICP Alignment',
    weight: 0.13,
    kind: 'dashboard',
    signals: [
      { signalId: 'messaging_fit_to_buyer', weight: 0.4, definition: 'Does the messaging appear written for the inferred buyer and their problem sophistication? Penalise only supported mismatches, never missing persona detail.' },
      { signalId: 'proof_fit_to_buyer', weight: 0.3, definition: 'Does the proof shown match what that buyer would find credible?' },
      { signalId: 'cta_fit_to_buying_stage', weight: 0.3, definition: 'Does the requested next action match where that buyer plausibly is in their decision process?' },
    ],
  },
  {
    categoryId: 'cta_effectiveness',
    label: 'CTA Effectiveness & Consistency',
    weight: 0.2,
    kind: 'dashboard',
    signals: [
      { signalId: 'primary_action_clarity', weight: 0.3, definition: 'Is the primary next action clear on the key pages? A header CTA is a contextual signal, not a universal requirement.' },
      { signalId: 'cta_intent_fit', weight: 0.25, definition: 'Is the CTA intent appropriate for the inferred primary conversion goal and buying stage?' },
      { signalId: 'competing_cta_ambiguity', weight: 0.2, inverted: true, definition: 'Do competing calls to action create REAL ambiguity about the next step? 4 = no harmful ambiguity, 0 = the visitor cannot tell what to do.' },
      { signalId: 'conversion_path_coherence', weight: 0.25, requires: 'multi_page', definition: 'Do the analysed pages form a coherent progression toward the primary conversion goal?' },
    ],
  },
  {
    categoryId: 'trust_credibility',
    label: 'Trust & Credibility',
    weight: 0.17,
    kind: 'dashboard',
    signals: [
      { signalId: 'proof_presence_at_decision_points', weight: 0.4, definition: 'Is legitimate proof present where a visitor decides: testimonials, cases, logos, ratings, credentials? Do not require every proof type.' },
      { signalId: 'proof_adequacy_for_risk', weight: 0.25, definition: 'Is the amount and type of proof adequate for the commitment and risk level of this offer?' },
      { signalId: 'identity_verifiability', weight: 0.2, definition: 'Can a visitor verify who the business is and how to contact it, where that is relevant? Do not invent legal or registration requirements for any market.' },
      { signalId: 'claim_substantiation', weight: 0.15, definition: 'Are strong claims and superlatives on the page substantiated by visible evidence?' },
    ],
  },
  {
    categoryId: 'navigation_flow',
    label: 'Navigation & User Flow',
    weight: 0.1,
    kind: 'dashboard',
    signals: [
      { signalId: 'path_comprehensibility', weight: 0.4, definition: 'Can a visitor understand the main paths through the site and the next step? Never penalise menu length mechanically.' },
      { signalId: 'goal_supportiveness', weight: 0.35, definition: 'Does the navigation support the primary conversion goal rather than distract from it?' },
      { signalId: 'key_page_discoverability', weight: 0.25, definition: 'Are the key offer, proof and action pages discoverable from the main navigation?' },
    ],
  },
  {
    categoryId: 'conversion_friction',
    label: 'Conversion Friction',
    weight: 0.12,
    kind: 'dashboard',
    signals: [
      { signalId: 'hero_focus', weight: 0.35, inverted: true, definition: 'Is the hero focused, or overloaded and competing with the main action? 4 = focused.' },
      { signalId: 'time_to_value_comprehension', weight: 0.3, inverted: true, definition: 'How much explanation must be consumed before the visitor can act or understand the value? 4 = very little.' },
      { signalId: 'distraction_load', weight: 0.2, inverted: true, requires: 'layout_evidence', definition: 'Do layout facts show competing elements or obstruction around the primary action? 4 = no meaningful distraction. Never make aesthetic judgements.' },
      { signalId: 'action_friction', weight: 0.15, inverted: true, definition: 'Does the conversion action itself add avoidable friction, for example an unnecessarily long form for this goal? 4 = minimal friction.' },
    ],
  },
  {
    categoryId: 'performance_impact',
    label: 'Performance Impact',
    weight: 0.08,
    kind: 'dashboard',
    objective: true,
    signals: [],
  },
];

export const CONSISTENCY_CATEGORIES: CategoryDefinition[] = [
  {
    categoryId: 'messaging_consistency',
    label: 'Messaging Consistency',
    weight: 0,
    kind: 'consistency',
    signals: [
      { signalId: 'core_offer_reinforcement', weight: 0.6, requires: 'multi_page', definition: 'Do the pages reinforce the same core offer and value proposition, allowing page-specific nuance?' },
      { signalId: 'value_prop_contradiction_absence', weight: 0.4, inverted: true, requires: 'multi_page', definition: 'Do any pages contradict each other about what is offered or to whom? 4 = no contradiction.' },
    ],
  },
  {
    categoryId: 'icp_consistency',
    label: 'ICP Consistency',
    weight: 0,
    kind: 'consistency',
    signals: [
      { signalId: 'buyer_compatibility', weight: 1, requires: 'multi_page', definition: 'Do the pages appear to address compatible buyers and problems?' },
    ],
  },
  {
    categoryId: 'cta_consistency',
    label: 'CTA Consistency',
    weight: 0,
    kind: 'consistency',
    signals: [
      { signalId: 'progression_coherence', weight: 0.6, requires: 'multi_page', definition: 'Do the pages guide the visitor through a coherent conversion path? Identical button labels are NOT the target; a coherent progression across intent levels is.' },
      { signalId: 'cross_page_intent_appropriateness', weight: 0.4, requires: 'multi_page', definition: 'Is the CTA intent on each page appropriate for that page\'s role in the journey?' },
    ],
  },
  {
    categoryId: 'trust_consistency',
    label: 'Trust Consistency',
    weight: 0,
    kind: 'consistency',
    signals: [
      { signalId: 'proof_at_commitment_stages', weight: 1, requires: 'multi_page', definition: 'Does appropriate proof appear at the stages where scepticism and commitment increase?' },
    ],
  },
];

export const ALL_CATEGORIES = [...DASHBOARD_CATEGORIES, ...CONSISTENCY_CATEGORIES];

export interface PenaltyDefinition {
  penaltyId: string;
  points: number;
  categoryId: string;
  description: string;
}

export const PENALTIES: PenaltyDefinition[] = [
  { penaltyId: 'no_conversion_action', points: 25, categoryId: 'cta_effectiveness', description: 'No conversion action or form detected on any analysed page, with complete coverage.' },
  { penaltyId: 'goal_page_missing_primary_action', points: 15, categoryId: 'cta_effectiveness', description: 'The identified primary conversion page carries no action matching the primary conversion goal.' },
  { penaltyId: 'no_contact_affordance', points: 10, categoryId: 'trust_credibility', description: 'No contact method anywhere across header, footer or contact page, with complete coverage.' },
  { penaltyId: 'cross_page_contradiction', points: 10, categoryId: 'messaging_clarity', description: 'A consistency signal scored 0 with valid refs across at least two pages.' },
];

export const MAX_PENALTY_PER_CATEGORY = 30;
export const CATEGORY_AVAILABILITY_THRESHOLD = 0.5;
export const OVERALL_AVAILABILITY_THRESHOLD = 0.6;

/** Performance thresholds — piecewise linear, 100 / 50 / 0 anchors. */
export const PERFORMANCE_METRICS = [
  { metric: 'lcpMs', weight: 0.5, good: 2500, mid: 4000, poor: 6000 },
  { metric: 'tbtMs', weight: 0.3, good: 200, mid: 600, poor: 1200 },
  { metric: 'clsScore', weight: 0.2, good: 0.1, mid: 0.25, poor: 0.4 },
] as const;

export function rubricHash(): string {
  const payload = JSON.stringify({
    DASHBOARD_CATEGORIES,
    CONSISTENCY_CATEGORIES,
    PENALTIES,
    PERFORMANCE_METRICS,
    MAX_PENALTY_PER_CATEGORY,
    CATEGORY_AVAILABILITY_THRESHOLD,
    OVERALL_AVAILABILITY_THRESHOLD,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

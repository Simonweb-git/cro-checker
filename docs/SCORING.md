# Scoring architecture — rubric `croh-v1`

`scoringVersion = "croh-v1"`. This document is the specification; `src/core/scoring/rubric.v1.ts` is the
executable copy. A change to weights, thresholds or signal names **requires a version bump** — enforced by
a rubric-hash regression test.

## 1. Division of labour

- An LLM classifies **one named signal at a time** on the bounded scale `0 | 1 | 2 | 3 | 4 |
  not_applicable | insufficient_evidence`, and must return `evidenceRefs` + `confidence`.
- Objective signals (marked **OBJ**) are computed by code from evidence or measurements. No model input.
- **Only code** converts signals into 0–100 category scores and the overall score.

Signal → points: `points = value / 4 * 100` (0→0, 1→25, 2→50, 3→75, 4→100).
`not_applicable` and `insufficient_evidence` remove the signal *and its weight* from the category.

## 2. Confidence damping

`confidence: high | medium` → weight × 1.0. `confidence: low` → weight × 0.5.
A low-confidence signal still counts, but cannot dominate a category. Deterministic, no exceptions.

## 3. Category formula

```
available   = signals with a numeric value after N/A + insufficient_evidence removal
effWeight(s)= baseWeight(s) * confidenceFactor(s)
raw         = Σ effWeight(s) * points(s) / Σ effWeight(s)
score       = clamp(0, 100, round(raw - penalties(category)))
```

A category is **available** only if `Σ baseWeight(available) ≥ 0.5 × Σ baseWeight(all applicable)`.
Otherwise the category is `unavailable` with a machine-readable reason. Unavailable ≠ 0.

## 4. Dashboard categories, weights and signals

Category weights for Overall CRO Health:

| Category | Weight |
|---|---|
| Messaging Clarity | 0.20 |
| CTA Effectiveness & Consistency | 0.20 |
| Trust & Credibility | 0.17 |
| ICP Alignment | 0.13 |
| Conversion Friction | 0.12 |
| Navigation & User Flow | 0.10 |
| Performance Impact | 0.08 |

### Messaging Clarity
| Signal | w | Notes |
|---|---|---|
| `offer_clarity` | 0.35 | Can a relevant visitor tell what is offered? Hero as a whole, not one headline. |
| `audience_recognizability` | 0.25 | Is the intended buyer/problem recognizable? |
| `outcome_specificity` | 0.25 | Is the value/outcome specific enough to matter? |
| `differentiation_visibility` | 0.15 | `not_applicable` where the archetype does not require it. |

### ICP Alignment
| Signal | w |
|---|---|
| `messaging_fit_to_buyer` | 0.40 |
| `proof_fit_to_buyer` | 0.30 |
| `cta_fit_to_buying_stage` | 0.30 |

### CTA Effectiveness & Consistency
| Signal | w | Notes |
|---|---|---|
| `primary_action_clarity` | 0.30 | Per key page, aggregated by the model into one judgement. |
| `cta_intent_fit` | 0.25 | Relative to inferred `primaryConversionGoal`. |
| `competing_cta_ambiguity` | 0.20 | **Inverted**: 4 = no real ambiguity. |
| `conversion_path_coherence` | 0.25 | Requires ≥2 usable pages, else `not_applicable`. |

Header-CTA absence is **not** a signal of its own (reasoning spec §6.3); it may only influence
`primary_action_clarity` when the archetype benefits from persistent access.

### Trust & Credibility
| Signal | w | Notes |
|---|---|---|
| `proof_presence_at_decision_points` | 0.40 | |
| `proof_adequacy_for_risk` | 0.25 | Judge adequacy, never require every proof type. |
| `identity_verifiability` | 0.20 | Cross-checked against OBJ contact/company evidence. |
| `claim_substantiation` | 0.15 | Unsubstantiated superlatives, not legal registration rules. |

### Navigation & User Flow
| Signal | w |
|---|---|
| `path_comprehensibility` | 0.40 |
| `goal_supportiveness` | 0.35 |
| `key_page_discoverability` | 0.25 |

Menu length alone never scores. No mechanical item-count penalty.

### Conversion Friction  (all inverted: 4 = low friction)
| Signal | w | Notes |
|---|---|---|
| `hero_focus` | 0.35 | |
| `time_to_value_comprehension` | 0.30 | |
| `distraction_load` | 0.20 | Requires layout/screenshot evidence, else `insufficient_evidence`. |
| `action_friction` | 0.15 | Form field count/intent, not aesthetics. |

### Performance Impact — **OBJ only**
Computed from the measured mobile lab result; no model involvement. Piecewise-linear, clamped 0–100:

| Metric | 100 pts | 50 pts | 0 pts | w |
|---|---|---|---|---|
| LCP | ≤ 2.5 s | 4.0 s | ≥ 6.0 s | 0.50 |
| TBT | ≤ 200 ms | 600 ms | ≥ 1200 ms | 0.30 |
| CLS | ≤ 0.10 | 0.25 | ≥ 0.40 | 0.20 |

No reliable measurement → category `unavailable` with reason `no_measurement`. Never estimated from
page complexity or appearance.

## 5. Deterministic penalties

Applied after the weighted mean, capped at **30 points total per category**. Each penalty requires the
stated evidence *and* sufficient `extractionCoverage`; otherwise it is not applied.

| Penalty | Points | Applies to | Trigger |
|---|---|---|---|
| `no_conversion_action` | 25 | CTA | No conversion action/form detected on any selected page, coverage complete. |
| `goal_page_missing_primary_action` | 15 | CTA | The page identified as the primary conversion page has no matching action. |
| `no_contact_affordance` | 10 | Trust | No contact method anywhere (header, footer, contact page), coverage complete. |
| `cross_page_contradiction` | 10 | Messaging Clarity | A consistency signal scored 0 with valid refs on ≥2 pages. |

## 6. Consistency scores

Separate block; **not** part of Overall CRO Health. Requires ≥ 2 successfully extracted pages, else all
four are `unavailable` with reason `insufficient_pages`.

| Category | Signals (weights) |
|---|---|
| Messaging Consistency | `core_offer_reinforcement` 0.6, `value_prop_contradiction_absence` 0.4 |
| ICP Consistency | `buyer_compatibility` 1.0 |
| CTA Consistency | `progression_coherence` 0.6, `cross_page_intent_appropriateness` 0.4 |
| Trust Consistency | `proof_at_commitment_stages` 1.0 |

Identical wording is **not** the target; a coherent progression across intent levels scores 4.

## 7. Overall CRO Health

```
availableWeight = Σ weight(available categories)
overall         = round( Σ weight(c) * score(c) / availableWeight )
```

If `availableWeight < 0.60`, Overall is `unavailable` (reason `insufficient_category_coverage`) and the
report presents category scores only. Unavailable categories are never coerced to 0.

`ecommerce_unsupported` → no dashboard is produced at all.

## 8. Status bands (narration only)

`90–100 Excellent · 75–89 Strong · 60–74 Average · 40–59 Weak · 0–39 Critical`

The reasoning layer narrates the band; it never invents or adjusts the number.

## 9. Persisted for every analysis

Raw signal classifications with refs and confidence, effective weights, per-category sub-scores, each
applied penalty with its trigger, final scores, and all five version stamps. This is what makes a score
debuggable and the ±5-point repeatability gate measurable.

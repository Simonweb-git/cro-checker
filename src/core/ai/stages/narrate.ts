import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import type { ScoreSet } from '../../schemas/scores.js';
import { NarrationOutput } from '../../schemas/report.js';
import { buildRefRegistry, evidencePayload } from '../evidence-payload.js';
import { NARRATION_SYSTEM, fenceEvidence, languageDirective } from '../prompts.js';

export interface NarrationStageInput {
  evidence: WebsiteEvidence;
  context: SiteContext;
  scores: ScoreSet;
  model: string;
  client: ModelClient;
}

/**
 * Stage 6: explains code-computed scores. Word limits are enforced in code afterwards.
 *
 * Deliberately takes no `findings` input. It never cited a specific finding for evidence — only
 * listed title/severity as loose "don't contradict this" context — and narration is not itself
 * QA-checked, so there was no architectural guarantee tying its correctness to the post-QA findings
 * list anyway. Dropping the dependency lets the orchestrator start this call right after `scoring`
 * (scores are final and immutable from that point on, per ADR-003) instead of waiting for
 * diagnose→fix→qa_review to finish — the single biggest lever found for cutting total pipeline time.
 * Category score bands alone (Weak/Critical etc.) carry enough severity signal for the narration
 * prose to read appropriately serious without naming a specific finding.
 */
export async function runNarrationStage(input: NarrationStageInput) {
  const registry = buildRefRegistry(input.evidence);
  const { data } = await input.client.generateStructured(input.model, NarrationOutput, {
    stage: 'narration',
    system: NARRATION_SYSTEM,
    temperature: 0.2,
    // Up to ~11 category narrations plus three longer prose fields — see the same note on
    // diagnose.ts's maxOutputTokens.
    maxOutputTokens: 8000,
    // See signals.ts: most valuable for this call's own internal retries, since narration only runs
    // once per analysis.
    cacheableContext: fenceEvidence(evidencePayload(input.evidence)),
    prompt: [
      languageDirective(input.context.reportLanguage),
      '',
      `Scores to narrate (bands: 90-100 Excellent, 75-89 Strong, 60-74 Average, 40-59 Weak, 0-39 Critical): ${JSON.stringify(
        { overall: input.scores.overall, dashboard: input.scores.dashboard, consistency: input.scores.consistency },
      )}`,
      '',
      'Return one narration per dashboard AND consistency category, using the categoryId values above.',
    ].join('\n'),
  });

  const knownCategories = new Set([
    ...input.scores.dashboard.map((c) => c.categoryId),
    ...input.scores.consistency.map((c) => c.categoryId),
  ]);

  return {
    ...data,
    executiveSummary: trimWords(data.executiveSummary, 150),
    narrations: data.narrations
      .filter((n) => knownCategories.has(n.categoryId))
      .map((n) => ({ ...n, supportingEvidenceRefs: n.supportingEvidenceRefs.filter((r) => registry.has(r)) })),
  };
}

/** The 150-word executive summary cap is a product rule, so code enforces it. */
export function trimWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}

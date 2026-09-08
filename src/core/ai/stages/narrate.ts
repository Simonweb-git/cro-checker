import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import type { ScoreSet } from '../../schemas/scores.js';
import type { DiagnosticFindings } from '../../schemas/findings.js';
import { NarrationOutput } from '../../schemas/report.js';
import { buildRefRegistry, evidencePayload } from '../evidence-payload.js';
import { NARRATION_SYSTEM, fenceEvidence, languageDirective } from '../prompts.js';

export interface NarrationStageInput {
  evidence: WebsiteEvidence;
  context: SiteContext;
  scores: ScoreSet;
  findings: DiagnosticFindings;
  model: string;
  client: ModelClient;
}

/** Stage 6: explains code-computed scores. Word limits are enforced in code afterwards. */
export async function runNarrationStage(input: NarrationStageInput) {
  const registry = buildRefRegistry(input.evidence);
  const { data } = await input.client.generateStructured(input.model, NarrationOutput, {
    stage: 'narration',
    system: NARRATION_SYSTEM,
    temperature: 0.2,
    prompt: [
      languageDirective(input.context.reportLanguage),
      '',
      `Scores to narrate (bands: 90-100 Excellent, 75-89 Strong, 60-74 Average, 40-59 Weak, 0-39 Critical): ${JSON.stringify(
        { overall: input.scores.overall, dashboard: input.scores.dashboard, consistency: input.scores.consistency },
      )}`,
      '',
      `Validated findings already in the report: ${JSON.stringify(
        input.findings.findings.map((f) => ({ findingId: f.findingId, title: f.title, severity: f.severity })),
      )}`,
      '',
      'Return one narration per dashboard AND consistency category, using the categoryId values above.',
      '',
      fenceEvidence(evidencePayload(input.evidence)),
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

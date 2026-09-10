import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import { RATIONALE_MAX_LENGTH, SignalBatchOutput, type SignalAssessment } from '../../schemas/signals.js';
import { buildRefRegistry, evidencePayload } from '../evidence-payload.js';
import { fenceEvidence, SIGNAL_SYSTEM } from '../prompts.js';
import {
  CONSISTENCY_CATEGORIES,
  DASHBOARD_CATEGORIES,
  type CategoryDefinition,
} from '../../scoring/rubric.v1.js';

export interface SignalStageInput {
  evidence: WebsiteEvidence;
  context: SiteContext;
  model: string;
  client: ModelClient;
}

/**
 * Stage 2: bounded semantic classification, one category per call.
 * Preconditions that code can decide (multi-page, layout evidence) are resolved HERE, not by the
 * model, so an unmeasurable signal can never be guessed at.
 *
 * Categories are classified CONCURRENTLY. A live run showed the sequential version accumulating
 * enough wall time across ~10 independent category calls (plus site-context/diagnose/fix/qa/
 * narration) to hit the Vercel function's execution ceiling mid-pipeline, leaving the job stuck with
 * no error ever recorded. Each category call is independent — no shared state, no ordering
 * requirement — so there is no correctness reason for them to run one at a time, and it also serves
 * the product's own latency target (build spec §19: P50 <= 90s).
 */
export async function runSignalStage(input: SignalStageInput): Promise<SignalAssessment[]> {
  const registry = buildRefRegistry(input.evidence);
  const multiPage = input.evidence.pages.length >= 2;
  const hasLayout = input.evidence.pages.some((p) => p.layoutFacts.length > 0);

  const categories: CategoryDefinition[] = [
    ...DASHBOARD_CATEGORIES.filter((c) => !c.objective),
    ...(multiPage ? CONSISTENCY_CATEGORIES : []),
  ];

  const perCategory = await Promise.all(
    categories.map((category) => classifyCategory(category, { ...input, multiPage, hasLayout, registry })),
  );

  return perCategory.flat();
}

interface ClassifyCategoryContext extends SignalStageInput {
  multiPage: boolean;
  hasLayout: boolean;
  registry: Set<string>;
}

async function classifyCategory(
  category: CategoryDefinition,
  ctx: ClassifyCategoryContext,
): Promise<SignalAssessment[]> {
  const out: SignalAssessment[] = [];
  const askable = category.signals.filter((signal) => {
    if (signal.requires === 'multi_page' && !ctx.multiPage) return false;
    if (signal.requires === 'layout_evidence' && !ctx.hasLayout) return false;
    return true;
  });

  // Signals we cannot ask about are recorded as insufficient_evidence, never quietly dropped.
  for (const signal of category.signals) {
    if (!askable.includes(signal)) {
      out.push({
        signalId: signal.signalId,
        value: 'insufficient_evidence',
        evidenceRefs: [],
        confidence: 'high',
        rationale:
          signal.requires === 'multi_page'
            ? 'Fewer than two pages were successfully analysed.'
            : 'No layout or screenshot evidence was captured for this analysis.',
      });
    }
  }
  if (askable.length === 0) return out;

  const { data } = await ctx.client.generateStructured(ctx.model, SignalBatchOutput, {
    stage: `signals:${category.categoryId}`,
    system: SIGNAL_SYSTEM,
    temperature: 0,
    prompt: [
      `Site context (already established by the engine): ${JSON.stringify({
        siteArchetype: ctx.context.siteArchetype.value,
        primaryConversionGoal: ctx.context.primaryConversionGoal.value,
        primaryICP: ctx.context.primaryICP.value,
      })}`,
      '',
      `Classify exactly these signals for category "${category.label}":`,
      ...askable.map(
        (s) => `- ${s.signalId}${s.inverted ? ' [INVERTED: 4 = little/none of the negative thing]' : ''}: ${s.definition}`,
      ),
      '',
      fenceEvidence(evidencePayload(ctx.evidence)),
    ].join('\n'),
  });

  const askableIds = new Set(askable.map((s) => s.signalId));
  for (const assessment of data.assessments) {
    if (!askableIds.has(assessment.signalId)) continue; // model invented a signal name
    const refs = assessment.evidenceRefs.filter((ref) => ctx.registry.has(ref));
    // A numeric judgement with no valid ref is unsupported: downgrade rather than trust it.
    const unsupported = typeof assessment.value === 'number' && refs.length === 0;
    out.push({
      signalId: assessment.signalId,
      value: unsupported ? 'insufficient_evidence' : assessment.value,
      evidenceRefs: refs,
      confidence: unsupported ? 'high' : assessment.confidence,
      rationale: unsupported
        ? 'Classification cited no valid evidence reference and was rejected by the engine.'
        : truncate(assessment.rationale, RATIONALE_MAX_LENGTH),
    });
  }
  for (const signal of askable) {
    if (!out.some((a) => a.signalId === signal.signalId)) {
      out.push({
        signalId: signal.signalId,
        value: 'insufficient_evidence',
        evidenceRefs: [],
        confidence: 'high',
        rationale: 'The classifier did not return this signal.',
      });
    }
  }
  return out;
}

/**
 * Truncates rather than rejects: the model's tool-schema does not hard-enforce string length during
 * generation (see schemas/signals.ts), so this is where the domain cap is actually applied.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

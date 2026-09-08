import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import { SignalBatchOutput, type SignalAssessment } from '../../schemas/signals.js';
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
 */
export async function runSignalStage(input: SignalStageInput): Promise<SignalAssessment[]> {
  const registry = buildRefRegistry(input.evidence);
  const multiPage = input.evidence.pages.length >= 2;
  const hasLayout = input.evidence.pages.some((p) => p.layoutFacts.length > 0);
  const out: SignalAssessment[] = [];

  const categories: CategoryDefinition[] = [
    ...DASHBOARD_CATEGORIES.filter((c) => !c.objective),
    ...(multiPage ? CONSISTENCY_CATEGORIES : []),
  ];

  for (const category of categories) {
    const askable = category.signals.filter((signal) => {
      if (signal.requires === 'multi_page' && !multiPage) return false;
      if (signal.requires === 'layout_evidence' && !hasLayout) return false;
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
    if (askable.length === 0) continue;

    const { data } = await input.client.generateStructured(input.model, SignalBatchOutput, {
      stage: `signals:${category.categoryId}`,
      system: SIGNAL_SYSTEM,
      temperature: 0,
      prompt: [
        `Site context (already established by the engine): ${JSON.stringify({
          siteArchetype: input.context.siteArchetype.value,
          primaryConversionGoal: input.context.primaryConversionGoal.value,
          primaryICP: input.context.primaryICP.value,
        })}`,
        '',
        `Classify exactly these signals for category "${category.label}":`,
        ...askable.map(
          (s) => `- ${s.signalId}${s.inverted ? ' [INVERTED: 4 = little/none of the negative thing]' : ''}: ${s.definition}`,
        ),
        '',
        fenceEvidence(evidencePayload(input.evidence)),
      ].join('\n'),
    });

    const askableIds = new Set(askable.map((s) => s.signalId));
    for (const assessment of data.assessments) {
      if (!askableIds.has(assessment.signalId)) continue; // model invented a signal name
      const refs = assessment.evidenceRefs.filter((ref) => registry.has(ref));
      // A numeric judgement with no valid ref is unsupported: downgrade rather than trust it.
      const unsupported = typeof assessment.value === 'number' && refs.length === 0;
      out.push({
        signalId: assessment.signalId,
        value: unsupported ? 'insufficient_evidence' : assessment.value,
        evidenceRefs: refs,
        confidence: unsupported ? 'high' : assessment.confidence,
        rationale: unsupported
          ? 'Classification cited no valid evidence reference and was rejected by the engine.'
          : assessment.rationale,
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
  }

  return out;
}

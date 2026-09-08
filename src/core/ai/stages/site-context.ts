import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import { SiteContext, SiteContextOutput } from '../../schemas/context.js';
import { buildRefRegistry, evidencePayload } from '../evidence-payload.js';
import { fenceEvidence, SITE_CONTEXT_SYSTEM } from '../prompts.js';

export interface SiteContextStageInput {
  analysisId: string;
  evidence: WebsiteEvidence;
  configuredLanguage: string | null;
  model: string;
  client: ModelClient;
}

/** Stage 1: establish the conversion context BEFORE any CTA/flow judgement (build spec §5). */
export async function runSiteContextStage(input: SiteContextStageInput): Promise<SiteContext> {
  const registry = buildRefRegistry(input.evidence);
  const { data } = await input.client.generateStructured(input.model, SiteContextOutput, {
    stage: 'site_context',
    system: SITE_CONTEXT_SYSTEM,
    prompt: `Infer the conversion context for this website.\n\n${fenceEvidence(evidencePayload(input.evidence))}`,
    temperature: 0,
  });

  // Refs the model invented are stripped rather than trusted; confidence drops if that empties a field.
  const clean = (refs: string[]) => refs.filter((ref) => registry.has(ref));
  const detected = data.dominantLanguage?.slice(0, 5) ?? null;
  const languageFromPages = mostCommonLanguage(input.evidence);

  const reportLanguage = input.configuredLanguage ?? detected ?? languageFromPages ?? 'en';
  const reportLanguageSource = input.configuredLanguage
    ? ('configured' as const)
    : detected || languageFromPages
      ? ('detected' as const)
      : ('fallback' as const);

  const knownPageIds = new Set(input.evidence.pages.map((p) => p.pageId));

  return SiteContext.parse({
    ...data,
    schemaVersion: 'sitecontext-v1',
    analysisId: input.analysisId,
    siteArchetype: { ...data.siteArchetype, evidenceRefs: clean(data.siteArchetype.evidenceRefs) },
    primaryConversionGoal: {
      ...data.primaryConversionGoal,
      evidenceRefs: clean(data.primaryConversionGoal.evidenceRefs),
    },
    primaryICP: { ...data.primaryICP, evidenceRefs: clean(data.primaryICP.evidenceRefs) },
    secondaryICP: data.secondaryICP
      ? { ...data.secondaryICP, evidenceRefs: clean(data.secondaryICP.evidenceRefs) }
      : null,
    primaryConversionPageId:
      data.primaryConversionPageId && knownPageIds.has(data.primaryConversionPageId)
        ? data.primaryConversionPageId
        : null,
    reportLanguage,
    reportLanguageSource,
  });
}

function mostCommonLanguage(evidence: WebsiteEvidence): string | null {
  const counts = new Map<string, number>();
  for (const page of evidence.pages) {
    if (!page.language) continue;
    counts.set(page.language, (counts.get(page.language) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

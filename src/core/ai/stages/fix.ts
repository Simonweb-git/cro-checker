import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import type { DiagnosticFindings } from '../../schemas/findings.js';
import { FixOutput, type FixSet } from '../../schemas/fixes.js';
import { buildRefRegistry, evidencePayload } from '../evidence-payload.js';
import { checkRefs } from '../ref-validation.js';
import { FIX_SYSTEM, fenceEvidence, languageDirective } from '../prompts.js';

export interface FixStageInput {
  analysisId: string;
  evidence: WebsiteEvidence;
  context: SiteContext;
  findings: DiagnosticFindings;
  model: string;
  client: ModelClient;
}

/** Stage 4: implementation-ready changes for VALIDATED findings only — not a fresh diagnosis. */
export async function runFixStage(input: FixStageInput): Promise<FixSet> {
  if (input.findings.findings.length === 0) {
    return { schemaVersion: 'fixes-v1', analysisId: input.analysisId, fixes: [], droppedFixes: [] };
  }
  const registry = buildRefRegistry(input.evidence);
  const { data } = await input.client.generateStructured(input.model, FixOutput, {
    stage: 'fix',
    system: FIX_SYSTEM,
    temperature: 0.3,
    prompt: [
      languageDirective(input.context.reportLanguage),
      '',
      `Site context: ${JSON.stringify({
        siteArchetype: input.context.siteArchetype.value,
        primaryConversionGoal: input.context.primaryConversionGoal.value,
        primaryICP: input.context.primaryICP.value,
      })}`,
      '',
      `Validated findings to fix (use these findingIds exactly): ${JSON.stringify(
        input.findings.findings.map((f) => ({
          findingId: f.findingId,
          title: f.title,
          severity: f.severity,
          affectedPages: f.affectedPages,
          observedFact: f.observedFact,
          recommendedDirection: f.recommendedDirection,
        })),
      )}`,
      '',
      fenceEvidence(evidencePayload(input.evidence)),
    ].join('\n'),
  });

  const validFindingIds = new Set(input.findings.findings.map((f) => f.findingId));
  const knownPages = new Set(input.evidence.pages.map((p) => p.pageId));
  const fixes: FixSet['fixes'] = [];
  const dropped: FixSet['droppedFixes'] = [];

  for (const fix of data.fixes) {
    if (!validFindingIds.has(fix.findingId)) {
      dropped.push({ fixId: fix.fixId, reason: 'fix_for_unknown_finding' });
      continue;
    }
    if (!knownPages.has(fix.pageId)) {
      dropped.push({ fixId: fix.fixId, reason: 'fix_on_unknown_page' });
      continue;
    }
    const refCheck = checkRefs(fix.evidenceRefs, registry);
    if (!refCheck.ok) {
      dropped.push({ fixId: fix.fixId, reason: refCheck.reason ?? 'invalid_refs' });
      continue;
    }
    fixes.push(fix);
  }

  // Cap copy fixes at five and hero alternatives at three, in code (reasoning spec §10).
  let copyCount = 0;
  const capped = fixes.filter((fix) => {
    if (fix.kind !== 'copy') return true;
    copyCount += 1;
    return copyCount <= 5;
  });

  return {
    schemaVersion: 'fixes-v1',
    analysisId: input.analysisId,
    fixes: capped,
    droppedFixes: dropped,
  };
}

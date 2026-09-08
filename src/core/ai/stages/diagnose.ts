import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import type { ScoreSet } from '../../schemas/scores.js';
import { DiagnosticOutput, type DiagnosticFindings } from '../../schemas/findings.js';
import { buildRefRegistry, evidencePayload } from '../evidence-payload.js';
import { absenceClaimAllowed, checkRefs, pageIdsExist } from '../ref-validation.js';
import { DIAGNOSTIC_SYSTEM, fenceEvidence, languageDirective } from '../prompts.js';

export interface DiagnosticStageInput {
  analysisId: string;
  evidence: WebsiteEvidence;
  context: SiteContext;
  scores: ScoreSet;
  model: string;
  client: ModelClient;
}

/** Stage 3: 1-5 evidence-backed findings. Code enforces ref validity and the absence rule. */
export async function runDiagnosticStage(input: DiagnosticStageInput): Promise<DiagnosticFindings> {
  const registry = buildRefRegistry(input.evidence);
  const { data } = await input.client.generateStructured(input.model, DiagnosticOutput, {
    stage: 'diagnostic',
    system: DIAGNOSTIC_SYSTEM,
    temperature: 0.2,
    prompt: [
      languageDirective(input.context.reportLanguage),
      '',
      `Engine-established site context: ${JSON.stringify({
        siteArchetype: input.context.siteArchetype.value,
        primaryConversionGoal: input.context.primaryConversionGoal.value,
        primaryICP: input.context.primaryICP.value,
        primaryConversionPageId: input.context.primaryConversionPageId,
      })}`,
      '',
      `Engine-calculated scores (do not contradict or restate these as your own judgement): ${JSON.stringify({
        overall: input.scores.overall,
        dashboard: input.scores.dashboard.map((c) =>
          c.status === 'available'
            ? { categoryId: c.categoryId, score: c.score, penalties: c.penalties }
            : { categoryId: c.categoryId, status: 'unavailable', reason: c.reason },
        ),
        consistency: input.scores.consistency.map((c) =>
          c.status === 'available' ? { categoryId: c.categoryId, score: c.score } : { categoryId: c.categoryId, status: 'unavailable' },
        ),
      })}`,
      '',
      'Diagnose the smallest set of problems that most plausibly cost this business conversions.',
      '',
      fenceEvidence(evidencePayload(input.evidence)),
    ].join('\n'),
  });

  const findings: DiagnosticFindings['findings'] = [];
  const dropped: DiagnosticFindings['droppedFindings'] = [];
  const seenIds = new Set<string>();

  for (const finding of data.findings) {
    const refCheck = checkRefs(finding.evidenceRefs, registry);
    if (!refCheck.ok) {
      dropped.push({ title: finding.title, reason: refCheck.reason ?? 'invalid_refs' });
      continue;
    }
    const pageCheck = pageIdsExist(input.evidence, finding.affectedPages);
    if (!pageCheck.ok) {
      dropped.push({ title: finding.title, reason: pageCheck.reason ?? 'invalid_pages' });
      continue;
    }
    if (finding.assertsAbsence) {
      const absenceCheck = absenceClaimAllowed(input.evidence, finding.affectedPages);
      if (!absenceCheck.ok) {
        dropped.push({ title: finding.title, reason: absenceCheck.reason ?? 'absence_not_supported' });
        continue;
      }
    }
    if (seenIds.has(finding.findingId)) {
      dropped.push({ title: finding.title, reason: 'duplicate_finding_id' });
      continue;
    }
    seenIds.add(finding.findingId);
    findings.push(finding);
  }

  return {
    schemaVersion: 'findings-v1',
    analysisId: input.analysisId,
    findings: findings.slice(0, 5),
    droppedFindings: dropped,
  };
}

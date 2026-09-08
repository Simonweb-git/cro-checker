import type { ModelClient } from '../model-client.js';
import type { WebsiteEvidence } from '../../schemas/evidence.js';
import type { SiteContext } from '../../schemas/context.js';
import type { ScoreSet } from '../../schemas/scores.js';
import type { DiagnosticFindings } from '../../schemas/findings.js';
import type { FixSet } from '../../schemas/fixes.js';
import { QAOutput, type QAResults } from '../../schemas/qa.js';
import { evidencePayload } from '../evidence-payload.js';
import { QA_SYSTEM, fenceEvidence } from '../prompts.js';

export interface QAStageInput {
  analysisId: string;
  evidence: WebsiteEvidence;
  context: SiteContext;
  scores: ScoreSet;
  findings: DiagnosticFindings;
  fixes: FixSet;
  model: string;
  client: ModelClient;
}

export interface QAStageResult {
  qa: QAResults;
  findings: DiagnosticFindings;
  fixes: FixSet;
}

/**
 * Stage 5: independent critic, preferably a different model family (ADR-004).
 * It validates; it never writes a second diagnosis. REJECT removes the item (ADR-013).
 */
export async function runQAStage(input: QAStageInput): Promise<QAStageResult> {
  const { data } = await input.client.generateStructured(input.model, QAOutput, {
    stage: 'qa',
    system: QA_SYSTEM,
    temperature: 0,
    prompt: [
      `Engine-established site context: ${JSON.stringify({
        siteArchetype: input.context.siteArchetype.value,
        primaryConversionGoal: input.context.primaryConversionGoal.value,
        primaryICP: input.context.primaryICP.value,
      })}`,
      '',
      `Engine-calculated scores: ${JSON.stringify(
        input.scores.dashboard.map((c) =>
          c.status === 'available' ? { categoryId: c.categoryId, score: c.score } : { categoryId: c.categoryId, status: 'unavailable' },
        ),
      )}`,
      '',
      `Candidate findings (itemType "finding", itemId = findingId): ${JSON.stringify(input.findings.findings)}`,
      '',
      `Candidate fixes (itemType "fix", itemId = fixId): ${JSON.stringify(input.fixes.fixes)}`,
      '',
      'Return one verdict per candidate item. Do not invent new items.',
      '',
      fenceEvidence(evidencePayload(input.evidence)),
    ].join('\n'),
  });

  const findingIds = new Set(input.findings.findings.map((f) => f.findingId));
  const fixIds = new Set(input.fixes.fixes.map((f) => f.fixId));
  const results = data.results.filter((r) => findingIds.has(r.itemId) || fixIds.has(r.itemId));

  const rejected = new Set(results.filter((r) => r.verdict === 'REJECT').map((r) => r.itemId));
  const survivingFindings = input.findings.findings.filter((f) => !rejected.has(f.findingId));
  const survivingFindingIds = new Set(survivingFindings.map((f) => f.findingId));
  // A fix whose finding was rejected has nothing left to fix.
  const survivingFixes = input.fixes.fixes.filter(
    (f) => !rejected.has(f.fixId) && survivingFindingIds.has(f.findingId),
  );

  const stats = {
    pass: results.filter((r) => r.verdict === 'PASS').length,
    revise: results.filter((r) => r.verdict === 'REVISE').length,
    reject: results.filter((r) => r.verdict === 'REJECT').length,
    revisionAttempts: 0,
  };

  return {
    qa: { schemaVersion: 'qa-v1', analysisId: input.analysisId, results, stats },
    findings: {
      ...input.findings,
      findings: survivingFindings,
      droppedFindings: [
        ...input.findings.droppedFindings,
        ...input.findings.findings
          .filter((f) => rejected.has(f.findingId))
          .map((f) => ({
            title: f.title,
            reason: `qa_rejected: ${results.find((r) => r.itemId === f.findingId)?.reason ?? 'unsupported'}`,
          })),
      ],
    },
    fixes: {
      ...input.fixes,
      fixes: survivingFixes,
      droppedFixes: [
        ...input.fixes.droppedFixes,
        ...input.fixes.fixes
          .filter((f) => !survivingFixes.includes(f))
          .map((f) => ({
            fixId: f.fixId,
            reason: rejected.has(f.fixId) ? 'qa_rejected' : 'parent_finding_removed',
          })),
      ],
    },
  };
}

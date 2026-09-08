import { z } from 'zod';

export const QAVerdict = z.enum(['PASS', 'REVISE', 'REJECT']);
export type QAVerdict = z.infer<typeof QAVerdict>;

export const QAItemResult = z.object({
  itemId: z.string(),
  itemType: z.enum(['finding', 'fix', 'narration']),
  verdict: QAVerdict,
  reason: z.string().max(400),
  revisionInstruction: z.string().max(400).nullable(),
});
export type QAItemResult = z.infer<typeof QAItemResult>;

export const QAOutput = z.object({ results: z.array(QAItemResult) });
export type QAOutput = z.infer<typeof QAOutput>;

export const QAResults = z.object({
  schemaVersion: z.literal('qa-v1'),
  analysisId: z.string(),
  results: z.array(QAItemResult),
  /** Tracked as a quality signal; a rising rate triggers prompt/rubric work (build spec §20). */
  stats: z.object({
    pass: z.number().int(),
    revise: z.number().int(),
    reject: z.number().int(),
    revisionAttempts: z.number().int(),
  }),
});
export type QAResults = z.infer<typeof QAResults>;

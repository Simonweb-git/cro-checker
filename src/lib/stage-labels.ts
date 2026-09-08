/** Human labels for the actual workflow stages (build spec §17: "actual workflow stage names"). */
export const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  validating_url: 'Validating URL',
  discovering_pages: 'Discovering pages',
  extracting_pages: 'Extracting evidence',
  measuring_performance: 'Measuring performance',
  scoring: 'Scoring signals',
  diagnosing: 'Diagnosing conversion problems',
  generating_fixes: 'Generating fixes',
  qa_review: 'Independent QA review',
  assembling_report: 'Assembling report',
  completed: 'Completed',
  partial: 'Completed (partial)',
  failed: 'Failed',
};

export const DISPLAY_ORDER = [
  'queued',
  'validating_url',
  'discovering_pages',
  'extracting_pages',
  'measuring_performance',
  'scoring',
  'diagnosing',
  'generating_fixes',
  'qa_review',
  'assembling_report',
];

export function stageIndex(stage: string): number {
  const index = DISPLAY_ORDER.indexOf(stage);
  return index === -1 ? DISPLAY_ORDER.length : index;
}

import { STAGE_ORDER, TERMINAL_STAGES, type JobStage } from '../schemas/job.js';

/**
 * Guards stage transitions so a retried step can never move a job backwards or resurrect a
 * terminal job (build spec §7: "a retry must not overwrite a newer result unexpectedly").
 */
export function canTransition(from: JobStage, to: JobStage): boolean {
  if (from === to) return true;
  if (TERMINAL_STAGES.includes(from)) return false;
  if (TERMINAL_STAGES.includes(to)) return true;
  const fromIndex = STAGE_ORDER.indexOf(from);
  const toIndex = STAGE_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex > fromIndex;
}

export function assertTransition(from: JobStage, to: JobStage): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job transition ${from} -> ${to}`);
  }
}

export function isTerminal(stage: JobStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

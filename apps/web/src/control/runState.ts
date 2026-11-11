import type { RunSummary } from '@c9view/api';

/** A run still driving its session: not ended or failed. */
export function isActiveRun(run: Pick<RunSummary, 'state'>) {
  return run.state !== 'ended' && run.state !== 'failed';
}

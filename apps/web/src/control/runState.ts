import type { RunSummary } from '@c9view/api';

/** A run still driving its session: not ended or failed. */
export function isActiveRun(run: Pick<RunSummary, 'state'>) {
  return run.state !== 'ended' && run.state !== 'failed';
}

/** The session's current run: the latest active one, else the latest of any state. */
export function currentRun<T extends RunSummary>(
  runs: readonly T[] | undefined,
  projectId: string,
  sessionId: string,
): T | undefined {
  const mine = (run: T) =>
    run.projectId === projectId && run.sessionId === sessionId;
  return (
    runs?.findLast((run) => mine(run) && isActiveRun(run)) ??
    runs?.findLast(mine)
  );
}

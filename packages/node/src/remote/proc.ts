import { readFileSync } from 'node:fs';

type ReadText = (path: string) => string;
const readText: ReadText = (path) => readFileSync(path, 'utf8');

export interface ProcIdentity {
  pid: number;
  /** Decimal string of /proc/<pid>/stat field 22 (clock ticks since boot). */
  procStart: string;
}

/**
 * Field 22 of /proc/<pid>/stat. The command name (field 2) may hold spaces and
 * parentheses, so parse after the last ")". Fields 3.. follow, so field 22 is
 * index 19.
 */
export function parseProcStart(stat: string): string | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const field = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)[19];
  return field !== undefined && /^\d+$/.test(field) ? field : null;
}

/** Start time of a process, or null for any unreadable or malformed stat. */
export function readProcStart(
  pid: number | 'self',
  read: ReadText = readText,
): string | null {
  if (pid !== 'self' && !(Number.isSafeInteger(pid) && pid > 0)) return null;
  try {
    return parseProcStart(read(`/proc/${pid}/stat`));
  } catch {
    return null;
  }
}

/** The node's own identity, cached for the process lifetime once readable. */
export function createSelfIdentity(
  pid: number = process.pid,
  read: ReadText = readText,
): () => ProcIdentity | null {
  let cached: ProcIdentity | null = null;
  return () => {
    if (cached) return cached;
    const procStart = readProcStart('self', read);
    if (procStart === null) return null;
    cached = { pid, procStart };
    return cached;
  };
}

export const selfIdentity = createSelfIdentity();

/** True only when `pid` is alive now with exactly this start time (PID reuse). */
export function sameProcess(
  pid: number,
  procStart: string,
  read: ReadText = readText,
): boolean {
  if (!/^\d+$/.test(procStart)) return false;
  return readProcStart(pid, read) === procStart;
}

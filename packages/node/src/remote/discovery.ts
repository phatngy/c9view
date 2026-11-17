import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  schema.optional().catch(undefined);

/**
 * Explicit pick: every other field (peerToken, waitingFor, name, tmux, ...) is
 * dropped at parse time, never kept, logged, stored or returned. Zod objects
 * strip unknown keys by default; never use passthrough here.
 */
const liveSchema = z.object({
  sessionId: z.string(),
  pid: optional(z.number().int().positive()),
  procStart: optional(z.string().regex(/^\d+$/)),
  pidDomain: optional(z.union([z.string(), z.number()])),
  kind: optional(z.string()),
  entrypoint: optional(z.string()),
  version: optional(z.string()),
  peerProtocol: optional(z.number().int()),
  messagingSocketPath: optional(z.string()),
  status: optional(z.string()),
  cwd: optional(z.string()),
});
export type LiveFile = z.infer<typeof liveSchema>;

export type LiveLookup =
  { kind: 'none' } | { kind: 'unknown' } | { kind: 'found'; entry: LiveFile };

/**
 * Read `sessions/*.json` fresh for one session. Only `.json` names are opened,
 * so `*.key` files are never touched. A `.json` without a `sessionId` (token
 * only) is skipped silently. Exactly one matching entry is found; an
 * unreadable or unparsable file that names the session, or two entries, is
 * unknown (fail closed).
 */
export interface LiveJudge {
  alive(pid: number): boolean;
  procStartOf(pid: number): string | null;
  namespace(): Promise<string | undefined>;
}

const domainInode = (domain: string | number) =>
  String(domain).match(/(?:pid:\[)?(\d+)\]?$/)?.[1] ?? String(domain);

/**
 * With several entries for one session, a stale one (dead PID, or a PID that
 * now has another start time) is ignored, but only when it is judged in this
 * node's PID namespace. Exactly one survivor is used; two or more live, or
 * any entry that cannot be judged, stay unknown (fail closed).
 */
async function survivors(
  matches: LiveFile[],
  judge: LiveJudge,
): Promise<LiveLookup> {
  const namespace = await judge.namespace();
  const live: LiveFile[] = [];
  for (const entry of matches) {
    if (
      !namespace ||
      entry.pid === undefined ||
      entry.pidDomain === undefined ||
      domainInode(entry.pidDomain) !== namespace
    )
      return { kind: 'unknown' };
    if (!judge.alive(entry.pid)) continue;
    const started = judge.procStartOf(entry.pid);
    if (started === null) return { kind: 'unknown' };
    if (entry.procStart !== undefined && entry.procStart !== started) continue;
    live.push(entry);
  }
  if (live.length === 0) return { kind: 'none' };
  return live.length === 1
    ? { kind: 'found', entry: live[0]! }
    : { kind: 'unknown' };
}

export async function readLive(
  claudeDir: string,
  sessionId: string,
  judge?: LiveJudge,
): Promise<LiveLookup> {
  const directory = join(claudeDir, 'sessions');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'none' }
      : { kind: 'unknown' };
  }
  const quoted = JSON.stringify(sessionId);
  const matches: LiveFile[] = [];
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    let content: string;
    try {
      content = await readFile(join(directory, name), 'utf8');
    } catch (error) {
      // A file that vanished between readdir and read is simply gone.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (name.slice(0, -5) === sessionId) return { kind: 'unknown' };
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      if (name.slice(0, -5) === sessionId || content.includes(quoted))
        return { kind: 'unknown' };
      continue;
    }
    const parsed = liveSchema.safeParse(value);
    if (!parsed.success) {
      if (name.slice(0, -5) === sessionId || content.includes(quoted))
        return { kind: 'unknown' };
      continue;
    }
    if (parsed.data.sessionId === sessionId) matches.push(parsed.data);
  }
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1)
    return judge ? survivors(matches, judge) : { kind: 'unknown' };
  return { kind: 'found', entry: matches[0]! };
}

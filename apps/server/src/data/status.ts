import { decideStatus, type HookEvent, type StatusInput } from '@c9view/core';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { SessionStatus } from '@c9view/api';

const entrySchema = z
  .object({
    pid: z.number().int().positive().optional().catch(undefined),
    sessionId: z.string(),
    cwd: z.string().optional().catch(undefined),
    status: z.string().optional().catch(undefined),
    updatedAt: z.union([z.string(), z.number()]).optional().catch(undefined),
    statusUpdatedAt: z
      .union([z.string(), z.number()])
      .optional()
      .catch(undefined),
    name: z.string().optional().catch(undefined),
    kind: z.string().optional().catch(undefined),
    pidDomain: z.union([z.string(), z.number()]).optional().catch(undefined),
  })
  .passthrough();
export type LiveEntry = z.infer<typeof entrySchema>;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
export async function pidNamespace(): Promise<string | undefined> {
  try {
    return String((await stat('/proc/self/ns/pid')).ino);
  } catch {
    return undefined;
  }
}
function domainInode(domain: string | number): string {
  return String(domain).match(/(?:pid:\[)?(\d+)\]?$/)?.[1] ?? String(domain);
}
function iso(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function classifyStatus(
  entry: LiveEntry | undefined,
  pendingTool: string | null,
  options: {
    hookEvents?: HookEvent[];
    transcript?: StatusInput['transcript'];
    now?: number;
    namespace?: string;
    alive?: (pid: number) => boolean;
  } = {},
): SessionStatus {
  const foreign =
    entry?.pidDomain !== undefined &&
    options.namespace !== undefined &&
    domainInode(entry.pidDomain) !== options.namespace;
  const live =
    !!entry &&
    (foreign ||
      (entry.pid !== undefined && (options.alive ?? processAlive)(entry.pid)));
  return decideStatus({
    now: options.now ?? Date.now(),
    live: entry,
    liveAlive: live,
    pidNamespaceMismatch: foreign,
    hookEvents: options.hookEvents ?? [],
    transcript: options.transcript ?? {
      lastAssistantPendingToolUse: pendingTool
        ? { name: pendingTool }
        : undefined,
    },
  });
}
export async function readLiveEntries(
  claudeDir: string,
): Promise<Map<string, LiveEntry>> {
  const result = new Map<string, LiveEntry>();
  const directory = join(claudeDir, 'sessions');
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return result;
  }
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    try {
      const parsed = entrySchema.safeParse(
        JSON.parse(await readFile(join(directory, name), 'utf8')),
      );
      if (!parsed.success) continue;
      const previous = result.get(parsed.data.sessionId);
      const time = (entry: LiveEntry) =>
        Date.parse(iso(entry.statusUpdatedAt) ?? iso(entry.updatedAt) ?? '') ||
        0;
      if (!previous || time(parsed.data) >= time(previous))
        result.set(parsed.data.sessionId, parsed.data);
    } catch {
      /* A live writer may temporarily leave incomplete JSON. */
    }
  }
  return result;
}

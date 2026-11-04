import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { legacyHookStateDir } from './state-dir.js';
import { z } from 'zod';
import { HOOK_EVENTS, hookStateDir } from './writer.js';
export {
  HOOK_EVENTS,
  hookStateDir,
  appendHookEvent,
  normalizeHookEvent,
  readHookInput,
} from './writer.js';
export const hookEventSchema = z.object({
  v: z.literal(1),
  ts: z.iso.datetime(),
  event: z.enum(HOOK_EVENTS),
  sessionId: z.string().max(256),
  cwd: z.string().max(1024),
  toolName: z.string().max(256).optional(),
  notificationType: z.string().max(100).optional(),
  permissionMode: z.string().max(100).optional(),
  agentId: z.string().max(256).optional(),
  subagent: z.boolean().optional(),
  pid: z.number().int().positive().optional(),
});
export type HookEvent = z.infer<typeof hookEventSchema>;
/** Tracks byte offsets and inode changes; incomplete lines wait for the next read. */
export class HookEventTailer {
  private files = new Map<
    string,
    {
      ino: number;
      dev: number;
      offset: number;
      pending: Buffer;
      dropping: boolean;
    }
  >();
  readonly sessions = new Map<string, HookEvent[]>();
  lastEventAt: string | null = null;
  private hourCounts = new Map<number, number>();
  eventsLastHour(now = Date.now()): number {
    let total = 0;
    for (const [second, count] of this.hourCounts) {
      if (second * 1000 < now - 3600000) this.hourCounts.delete(second);
      else if (second * 1000 <= now) total += count;
    }
    return total;
  }
  constructor(
    readonly stateDir = hookStateDir(),
    private readonly maxSessions = 2000,
    readonly legacyStateDir = legacyHookStateDir(),
  ) {}
  get eventFiles(): string[] {
    return [
      ...new Set(
        [this.stateDir, this.legacyStateDir]
          .filter((dir): dir is string => dir !== undefined)
          .map((dir) => resolve(dir)),
      ),
    ].flatMap((dir) => [
      join(dir, 'events.1.jsonl'),
      join(dir, 'events.jsonl'),
    ]);
  }
  get legacyEventsFile(): string | null {
    return this.legacyStateDir &&
      resolve(this.legacyStateDir) !== resolve(this.stateDir)
      ? join(this.legacyStateDir, 'events.jsonl')
      : null;
  }
  async refresh(): Promise<void> {
    for (const path of this.eventFiles) {
      let file;
      try {
        file = await open(path, 'r');
      } catch {
        continue;
      }
      try {
        const info = await file.stat();
        let cursor = this.files.get(path);
        // A renamed active file has already been consumed under its old name.
        if (
          !cursor ||
          cursor.ino !== info.ino ||
          cursor.dev !== info.dev ||
          info.size < cursor.offset
        ) {
          cursor = [...this.files.values()].find(
            (c) =>
              c.ino === info.ino && c.dev === info.dev && c.offset <= info.size,
          );
          cursor = cursor
            ? { ...cursor }
            : {
                ino: info.ino,
                dev: info.dev,
                offset: 0,
                pending: Buffer.alloc(0),
                dropping: false,
              };
          this.files.set(path, cursor);
        }
        const buffer = Buffer.alloc(65536);
        while (cursor.offset < info.size) {
          const { bytesRead } = await file.read(
            buffer,
            0,
            Math.min(buffer.length, info.size - cursor.offset),
            cursor.offset,
          );
          if (!bytesRead) break;
          cursor.offset += bytesRead;
          const bytes = Buffer.concat([
            cursor.pending,
            buffer.subarray(0, bytesRead),
          ]);
          let start = 0;
          for (
            let end = bytes.indexOf(10);
            end !== -1;
            end = bytes.indexOf(10, start)
          ) {
            if (!cursor.dropping && end - start < 4096) {
              try {
                this.add(
                  hookEventSchema.parse(
                    JSON.parse(bytes.subarray(start, end).toString('utf8')),
                  ),
                );
              } catch {
                /* Ignore malformed records. */
              }
            }
            cursor.dropping = false;
            start = end + 1;
          }
          cursor.pending = bytes.subarray(start);
          if (cursor.pending.length >= 4096) {
            cursor.pending = Buffer.alloc(0);
            cursor.dropping = true;
          }
        }
      } finally {
        await file.close();
      }
    }
  }
  private add(event: HookEvent) {
    const second = Math.floor(Date.parse(event.ts) / 1000);
    if (second * 1000 >= Date.now() - 3600000)
      this.hourCounts.set(second, (this.hourCounts.get(second) ?? 0) + 1);
    this.eventsLastHour();
    const events = this.sessions.get(event.sessionId) ?? [];
    events.push(event);
    events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    this.sessions.delete(event.sessionId);
    this.sessions.set(event.sessionId, events.slice(-200));
    while (this.sessions.size > this.maxSessions)
      this.sessions.delete(this.sessions.keys().next().value!);
    if (!this.lastEventAt || event.ts > this.lastEventAt)
      this.lastEventAt = event.ts;
  }
}

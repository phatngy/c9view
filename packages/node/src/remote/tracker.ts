import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { originSchema, queuedCommandAttachmentSchema } from '@c9view/core';

/** Nothing here is message text: IDs, a path and a byte offset only. */
export interface Pending {
  msgId: string;
  operation: string;
  clientRequestId: string;
  projectId: string;
  sessionId: string;
  /** Transcript path; undefined when it could not be resolved at send time. */
  file: string | undefined;
  /** Bytes already past at send time; reads start here, never at the start. */
  offset: number;
}
export interface Delivery {
  turn: 'new-turn' | 'next-step';
  /** The transcript record's own timestamp, when it has a valid one. */
  deliveredAt?: string;
}
export interface TrackerDeps {
  /** Read-only: is the receipt still kept (002's `Receipts.has`)? */
  has(operation: string, id: string): boolean;
  onDelivered(pending: Pending, delivery: Delivery): void;
  onNotSeen(pending: Pending): void;
  /** Session-change hints (`session` events); returns an unsubscribe. */
  subscribe?(
    listener: (event: { event: string; data: unknown }) => void,
  ): () => void;
  notSeenMs: number;
  /** Fallback poll interval; default 2 s. */
  pollMs?: number;
}

const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;

interface Entry {
  pending: Pending;
  scanning: Promise<void> | undefined;
  timer: NodeJS.Timeout;
}

/** Match `origin.msg_id` on peer `user` and `queued_command` records only. */
function match(line: string, msgId: string): Delivery | undefined {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!record || typeof record !== 'object') return undefined;
  const r = record as {
    type?: unknown;
    origin?: unknown;
    attachment?: unknown;
    timestamp?: unknown;
  };
  let origin;
  let turn: Delivery['turn'];
  if (r.type === 'user') {
    origin = originSchema.safeParse(r.origin).data;
    turn = 'new-turn';
  } else if (r.type === 'attachment') {
    const attachment = queuedCommandAttachmentSchema.safeParse(r.attachment);
    if (!attachment.success) return undefined;
    origin = attachment.data.origin;
    turn = 'next-step';
  } else return undefined;
  if (origin?.kind !== 'peer' || origin.msg_id !== msgId) return undefined;
  const at =
    typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : Number.NaN;
  return {
    turn,
    ...(Number.isFinite(at) ? { deliveredAt: new Date(at).toISOString() } : {}),
  };
}

/**
 * Confirms delivery from the transcript by msg_id. In memory only; lost on a
 * restart. Reads only new complete lines, on session events and on a timer,
 * and stops at `delivered` or when the receipt is gone. Never resends.
 */
export class Tracker {
  private entries = new Map<string, Entry>();
  private interval: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private closed = false;
  constructor(private deps: TrackerDeps) {
    this.unsubscribe = deps.subscribe?.((event) => {
      if (event.event !== 'session') return;
      const data = event.data as { projectId?: unknown; sessionId?: unknown };
      for (const entry of this.entries.values())
        if (
          entry.pending.projectId === data.projectId &&
          entry.pending.sessionId === data.sessionId
        )
          void this.scan(entry);
    });
  }
  get size() {
    return this.entries.size;
  }
  track(pending: Pending) {
    if (this.closed || this.entries.has(pending.msgId)) return;
    const timer = setTimeout(() => {
      if (this.entries.get(pending.msgId)?.pending === pending)
        this.deps.onNotSeen(pending);
    }, this.deps.notSeenMs);
    timer.unref();
    this.entries.set(pending.msgId, { pending, scanning: undefined, timer });
    this.interval ??= setInterval(() => this.tick(), this.deps.pollMs ?? 2000);
    this.interval.unref();
  }
  /** Run a fallback pass now (also what the timer does). */
  tick(): Promise<void[]> {
    return Promise.all(
      [...this.entries.values()].map((entry) => {
        const { operation, clientRequestId } = entry.pending;
        if (!this.deps.has(operation, clientRequestId)) {
          this.drop(entry);
          return Promise.resolve();
        }
        return this.scan(entry);
      }),
    );
  }
  private drop(entry: Entry) {
    clearTimeout(entry.timer);
    this.entries.delete(entry.pending.msgId);
    if (this.entries.size === 0 && this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
  private scan(entry: Entry): Promise<void> {
    // One read at a time per entry, so duplicate events never read twice.
    entry.scanning ??= this.read(entry).finally(() => {
      entry.scanning = undefined;
    });
    return entry.scanning;
  }
  private async read(entry: Entry) {
    const { pending } = entry;
    if (pending.file === undefined) return;
    let handle;
    try {
      handle = await open(
        pending.file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const size = (await handle.stat()).size;
      const end = Math.min(size, pending.offset + MAX_SCAN_BYTES);
      if (end <= pending.offset) return;
      const buffer = Buffer.alloc(end - pending.offset);
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          read,
          buffer.length - read,
          pending.offset + read,
        );
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      const last = buffer.subarray(0, read).lastIndexOf(NEWLINE);
      if (last < 0) {
        // A full window with no newline is not a line we will ever match
        // (a transcript line is far smaller): skip it so the entry never stalls.
        if (read >= MAX_SCAN_BYTES) pending.offset += read;
        return;
      }
      // Only whole lines (split on a byte, so UTF-8 is never cut) are consumed.
      const text = buffer.subarray(0, last + 1).toString('utf8');
      pending.offset += last + 1;
      for (const line of text.split('\n')) {
        if (!line.includes(pending.msgId)) continue;
        const found = match(line, pending.msgId);
        if (!found) continue;
        if (this.entries.get(pending.msgId) === entry) {
          this.drop(entry);
          this.deps.onDelivered(pending, found);
        }
        return;
      }
    } catch {
      /* Unreadable now; the next pass retries from the same offset. */
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  close() {
    this.closed = true;
    this.unsubscribe?.();
    for (const entry of [...this.entries.values()]) this.drop(entry);
  }
}

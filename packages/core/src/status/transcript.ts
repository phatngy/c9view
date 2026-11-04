import { stat } from 'node:fs/promises';
import { readTranscript } from '../transcript/reader.js';
import { isAssistantRecord, isUserRecord } from '../transcript/schemas.js';
import type { StatusInput } from './index.js';

/** Stores only status metadata, never message text. */
export class TranscriptStatusCache {
  private entries = new Map<
    string,
    {
      ino: number;
      size: number;
      mtime: number;
      offset: number;
      pending: Map<string, { name: string; at?: string }>;
      signal: StatusInput['transcript'];
    }
  >();
  private flight = new Map<string, Promise<StatusInput['transcript']>>();
  get(path: string): Promise<StatusInput['transcript']> {
    const existing = this.flight.get(path);
    if (existing) return existing;
    const task = this.read(path).finally(() => this.flight.delete(path));
    this.flight.set(path, task);
    return task;
  }
  private async read(path: string): Promise<StatusInput['transcript']> {
    const info = await stat(path);
    let entry = this.entries.get(path);
    if (
      !entry ||
      entry.ino !== info.ino ||
      info.size < entry.size ||
      (info.size === entry.size && info.mtimeMs !== entry.mtime)
    )
      entry = {
        ino: info.ino,
        size: 0,
        mtime: 0,
        offset: 0,
        pending: new Map(),
        signal: {},
      };
    if (entry.size !== info.size || entry.mtime !== info.mtimeMs) {
      const reader = readTranscript(path, { fromOffset: entry.offset });
      for (;;) {
        const next = await reader.next();
        if (next.done) {
          entry.offset = next.value.endOffset;
          break;
        }
        const record = next.value.record;
        if (record.isSidechain) continue;
        const at =
          typeof record.timestamp === 'string' ? record.timestamp : undefined;
        if (at) entry.signal.lastAt = at;
        if (isUserRecord(record)) {
          entry.signal.asksQuestion = false;
          delete entry.signal.endedTurnAt;
          if (Array.isArray(record.message.content))
            for (const block of record.message.content) {
              if (
                block.type === 'tool_result' &&
                typeof block.tool_use_id === 'string'
              )
                entry.pending.delete(block.tool_use_id);
            }
        }
        if (isAssistantRecord(record)) {
          let text = '';
          let hasTools = false;
          for (const block of record.message.content) {
            if (
              block.type === 'tool_use' &&
              typeof block.id === 'string' &&
              typeof block.name === 'string'
            ) {
              hasTools = true;
              entry.pending.set(block.id, {
                name: block.name,
                ...(at ? { at } : {}),
              });
            }
            if (block.type === 'text' && typeof block.text === 'string')
              text = block.text;
          }
          entry.signal.asksQuestion = !hasTools && /\?\s*$/.test(text);
          if (record.message.stop_reason === 'end_turn' && at)
            entry.signal.endedTurnAt = at;
          else delete entry.signal.endedTurnAt;
        }
        while (entry.pending.size > 200)
          entry.pending.delete(entry.pending.keys().next().value!);
        entry.signal.lastAssistantPendingToolUse = [
          ...entry.pending.values(),
        ].at(-1);
      }
      entry.size = info.size;
      entry.mtime = info.mtimeMs;
    }
    this.entries.delete(path);
    this.entries.set(path, entry);
    while (this.entries.size > 2000)
      this.entries.delete(this.entries.keys().next().value!);
    return { ...entry.signal };
  }
}

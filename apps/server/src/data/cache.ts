import { stat, open } from 'node:fs/promises';
import {
  discoverProjects,
  loadPrices,
  resolvePrice,
  costOf,
  extractUsage,
  isAssistantRecord,
  isUserRecord,
  readTranscriptFile,
  summarizeSession,
  summarizeUsage,
  parseRecord,
  type TranscriptRecord,
  type SessionSummary,
} from '@c9view/core';
import type { Message, OverviewResponse } from '@c9view/api';
import { messages, tokens } from './messages.js';

/** Per-message accounting is retained only while records are in the LRU. */
interface State {
  totalMessages: number;
  summary: SessionSummary;
  usage: Map<string, TranscriptRecord>;
  assistantIds: Set<string>;
  toolIds: Set<string>;
  lastTools: Map<string, string>;
  preview: string | null;
  explicitTitle: boolean;
}
function fresh(): State {
  return {
    totalMessages: 0,
    summary: summarizeSession([]),
    usage: new Map(),
    assistantIds: new Set(),
    toolIds: new Set(),
    lastTools: new Map(),
    preview: null,
    explicitTitle: false,
  };
}
function update(
  state: State,
  records: TranscriptRecord[],
  malformed: number,
): void {
  const delta = summarizeSession(records, { malformed });
  const s = state.summary;
  const messageCount = s.messageCount;
  const tools = s.toolUseCounts;
  let newMessages = 0;
  for (const record of records) {
    if (
      isAssistantRecord(record) ||
      isUserRecord(record) ||
      record.type === 'system'
    )
      state.totalMessages++;
    if (
      record.type === 'ai-title' &&
      typeof record.aiTitle === 'string' &&
      record.aiTitle.trim()
    ) {
      s.title = record.aiTitle;
      state.explicitTitle = true;
    }
    if (isUserRecord(record)) {
      newMessages++;
      const content = record.message.content;
      if (Array.isArray(content))
        for (const block of content) {
          if (
            block.type === 'tool_result' &&
            typeof block.tool_use_id === 'string'
          )
            state.lastTools.delete(block.tool_use_id);
        }
    }
    if (isAssistantRecord(record)) {
      if (!state.assistantIds.has(record.message.id)) {
        newMessages++;
        state.assistantIds.add(record.message.id);
      }
      const accounting = parseRecord({
        type: 'assistant',
        requestId: undefined,
        message: {
          id: record.message.id,
          model: record.message.model,
          content: [],
          usage: record.message.usage,
        },
      });
      // Match the index: latest snapshot with usage wins for each message ID.
      if (record.message.usage || !state.usage.has(record.message.id))
        state.usage.set(record.message.id, accounting);
      const blocks = record.message.content.filter(
        (b) =>
          b.type === 'tool_use' &&
          typeof b.id === 'string' &&
          typeof b.name === 'string',
      );
      if (blocks.length) {
        state.lastTools.clear();
        for (const block of blocks) {
          state.lastTools.set(block.id as string, block.name as string);
          if (!state.toolIds.has(block.id as string)) {
            state.toolIds.add(block.id as string);
            const name = block.name as string;
            tools[name] = (tools[name] ?? 0) + 1;
          }
        }
      }
    }
    if (isUserRecord(record) || isAssistantRecord(record)) {
      const content = record.message.content;
      const text =
        typeof content === 'string'
          ? content
          : content
              .filter((b) => b.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text as string)
              .join('\n');
      if (text) state.preview = text.slice(0, 240);
    }
  }
  if (!state.explicitTitle) s.title ??= delta.title;
  s.sessionId = delta.sessionId ?? s.sessionId;
  s.cwd = delta.cwd ?? s.cwd;
  s.version = delta.version ?? s.version;
  s.firstAt = [s.firstAt, delta.firstAt]
    .filter((x): x is string => !!x)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  s.lastAt = [s.lastAt, delta.lastAt]
    .filter((x): x is string => !!x)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  s.models = [...new Set([...s.models, ...delta.models])];
  s.gitBranches = [...new Set([...s.gitBranches, ...delta.gitBranches])];
  s.permissionModes = [
    ...new Set([...s.permissionModes, ...delta.permissionModes]),
  ];
  s.messageCount = messageCount + newMessages;
  s.errorCount += delta.errorCount;
  s.malformed += malformed;
  s.usage = summarizeUsage(state.usage.values());
}
export interface Entry extends State {
  byModel: OverviewResponse['byModel'];
  costUsd: number;
  tail: Buffer;
  messages?: Message[];
  size: number;
  mtimeMs: number;
  ino: number;
  offset: number;
  records?: TranscriptRecord[];
}
export class TranscriptCache {
  private readonly prices = loadPrices();
  private entries = new Map<string, Entry>();
  private lru = new Map<string, Entry>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(private readonly capacity = 20) {}
  get retainedRecordCount(): number {
    return this.lru.size;
  }
  peek(path: string): Entry | undefined {
    return this.entries.get(path);
  }
  async get(path: string, full = false): Promise<Entry> {
    const previous = this.locks.get(path) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.read(path, full));
    this.locks.set(path, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(path) === task) this.locks.delete(path);
    }
  }
  private async read(path: string, full: boolean): Promise<Entry> {
    const info = await stat(path);
    let entry = this.entries.get(path);
    const changed =
      !entry ||
      info.size !== entry.size ||
      info.mtimeMs !== entry.mtimeMs ||
      info.ino !== entry.ino;
    const reload = full && !entry?.records;
    if (changed || reload) {
      const incremental =
        entry &&
        !reload &&
        entry.records &&
        info.ino === entry.ino &&
        info.size > entry.size &&
        info.mtimeMs >= entry.mtimeMs &&
        entry.tail.equals(await tail(path, entry.offset));
      const read = await readTranscriptFile(path, {
        fromOffset: incremental ? entry!.offset : 0,
      });
      if (!incremental || read.reset) {
        entry = {
          ...fresh(),
          size: 0,
          mtimeMs: 0,
          ino: info.ino,
          offset: 0,
          tail: Buffer.alloc(0),
          byModel: [],
          costUsd: 0,
        };
      }
      entry ??= {
        ...fresh(),
        size: 0,
        mtimeMs: 0,
        ino: info.ino,
        offset: 0,
        tail: Buffer.alloc(0),
        byModel: [],
        costUsd: 0,
      };
      update(entry, read.records, read.malformed);
      if (full || entry.records)
        entry.records = incremental
          ? [...(entry.records ?? []), ...read.records]
          : read.records;
      const prices = await this.prices;
      const costs = new Map<string, number>();
      for (const record of entry.usage.values()) {
        if (!isAssistantRecord(record)) continue;
        const model = record.message.model;
        const price = resolvePrice(prices, model);
        const cost = price
          ? costOf(
              {
                ...extractUsage(record.message.usage),
                cacheCreation5m:
                  record.message.usage?.cache_creation
                    ?.ephemeral_5m_input_tokens ??
                  Math.max(
                    0,
                    (record.message.usage?.cache_creation_input_tokens ?? 0) -
                      (record.message.usage?.cache_creation
                        ?.ephemeral_1h_input_tokens ?? 0),
                  ),
              },
              price.price,
            )
          : 0;
        costs.set(model, (costs.get(model) ?? 0) + cost);
      }
      entry.byModel = Object.entries(entry.summary.usage.byModel).map(
        ([model, usage]) => ({
          model,
          tokens: tokens(usage),
          costUsd: costs.get(model) ?? 0,
        }),
      );
      entry.costUsd = entry.byModel.reduce(
        (sum, value) => sum + value.costUsd,
        0,
      );
      delete entry.messages;
      Object.assign(entry, {
        size: info.size,
        mtimeMs: info.mtimeMs,
        ino: info.ino,
        offset: read.endOffset,
        tail: await tail(path, read.endOffset),
      });
      this.entries.set(path, entry);
    }
    if (!entry) throw new Error('Transcript unavailable');
    if (full) {
      this.lru.delete(path);
      this.lru.set(path, entry);
      while (this.lru.size > this.capacity) {
        const oldest = this.lru.keys().next().value!;
        const evicted = this.lru.get(oldest)!;
        release(evicted);
        this.lru.delete(oldest);
      }
    } else if (this.lru.has(path)) this.lru.set(path, entry);
    if (!entry.records) release(entry);
    return entry;
  }
  async mapped(path: string): Promise<{ entry: Entry; messages: Message[] }> {
    const entry = await this.get(path, true);
    entry.messages ??= messages(entry.records ?? []);
    return { entry, messages: entry.messages };
  }
  async warm(claudeDir: string): Promise<void> {
    for (const project of await discoverProjects(claudeDir))
      for (const file of project.sessionFiles) {
        try {
          await this.get(file.path);
        } catch {
          /* A session can disappear during a scan. */
        }
      }
  }
}

// Keep only session aggregates outside the transcript LRU. A changed evicted
// entry is reloaded so duplicate assistant snapshots remain correctly accounted.
function release(entry: Entry): void {
  delete entry.records;
  delete entry.messages;
  entry.usage.clear();
  entry.assistantIds.clear();
  entry.toolIds.clear();
}
async function tail(path: string, offset: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(64, offset));
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.length,
      offset - buffer.length,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

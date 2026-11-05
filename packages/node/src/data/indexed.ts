import {
  getMessages,
  getSession,
  readRawRecords,
  parseRecord,
  emptyUsage,
  type IndexDatabase,
} from '@c9view/core';
import type { Entry } from './cache.js';
import { messages, tokens } from './messages.js';

export type IndexedSession = NonNullable<
  ReturnType<typeof import('@c9view/core').getSession>
>;
interface Row {
  uuid: string;
  byteOffset: number;
  type: string;
  toolUses: Record<string, string>;
}
export function messageRows(db: IndexDatabase, id: string): Row[] {
  return db.sqlite
    .prepare(
      'SELECT uuid, byteOffset, type, toolUses FROM messages WHERE sessionId = ? ORDER BY byteOffset',
    )
    .all(id)
    .map((row) => {
      const r = row as Omit<Row, 'toolUses'> & { toolUses: string };
      return {
        ...r,
        toolUses: JSON.parse(r.toolUses) as Record<string, string>,
      };
    });
}
const entries = new WeakMap<
  IndexDatabase,
  Map<string, { stamp: string; entry: Entry }>
>();
const pages = new WeakMap<
  IndexDatabase,
  Map<
    string,
    {
      stamp: string;
      value: NonNullable<Awaited<ReturnType<typeof readIndexedMessages>>>;
    }
  >
>();
function stamp(s: IndexedSession) {
  return `${s.fileIdentity}:${s.fileSize}:${s.fileMtimeMs}:${s.byteOffset}`;
}
export function indexedEntry(
  db: IndexDatabase,
  s: IndexedSession,
  full = false,
): Entry {
  const cache =
    entries.get(db) ?? new Map<string, { stamp: string; entry: Entry }>();
  entries.set(db, cache);
  const key = `${s.id}:${full}`;
  const previous = cache.get(key);
  if (previous?.stamp === stamp(s)) return previous.entry;
  const total = db.sqlite
    .prepare(
      "SELECT count(*) AS n FROM messages WHERE sessionId=? AND type IN ('user','assistant','system')",
    )
    .get(s.id) as { n: number };
  const preview = db.sqlite
    .prepare(
      "SELECT text FROM messages WHERE sessionId=? AND type IN ('user','assistant') AND text != '' ORDER BY byteOffset DESC LIMIT 1",
    )
    .get(s.id) as { text: string } | undefined;
  const entry: Entry = {
    summary: {
      sessionId: s.id,
      title: s.title ?? undefined,
      cwd: s.cwd ?? undefined,
      version: s.version ?? undefined,
      firstAt: s.firstAt ?? undefined,
      lastAt: s.lastAt ?? undefined,
      models: s.models,
      gitBranches: s.gitBranch ? [s.gitBranch] : [],
      permissionModes: s.permissionModes,
      messageCount: s.messageCount,
      toolUseCounts: s.toolUseCounts,
      errorCount: s.errorCount,
      malformed: s.malformed,
      usage: { total: { ...emptyUsage(), ...tokens(s) }, byModel: {} },
    },
    totalMessages: total.n,
    preview: preview?.text.slice(0, 240) ?? null,
    byModel: full ? sessionModels(db, s.id) : [],
    costUsd: s.costUsd,
    usage: new Map(),
    assistantIds: new Set(),
    toolIds: new Set(),
    lastTools: new Map(),
    explicitTitle: true,
    tail: Buffer.alloc(0),
    size: s.fileSize,
    mtimeMs: s.fileMtimeMs,
    ino: 0,
    offset: s.byteOffset,
  };
  cache.set(key, { stamp: stamp(s), entry });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return entry;
}
export async function indexedMessages(
  db: IndexDatabase,
  id: string,
  cursor: number | 'end',
  limit: number,
  before = Number.MAX_SAFE_INTEGER,
) {
  const session = getSession(db, id);
  if (!session) return null;
  const cache =
    pages.get(db) ??
    new Map<
      string,
      {
        stamp: string;
        value: NonNullable<Awaited<ReturnType<typeof readIndexedMessages>>>;
      }
    >();
  pages.set(db, cache);
  const key = JSON.stringify([id, cursor, limit, before]);
  const previous = cache.get(key);
  if (previous?.stamp === stamp(session)) return previous.value;
  const value = await readIndexedMessages(db, id, cursor, limit, before);
  if (value) {
    cache.set(key, { stamp: stamp(session), value });
    if (cache.size > 20) cache.delete(cache.keys().next().value!);
  }
  return value;
}
async function readIndexedMessages(
  db: IndexDatabase,
  id: string,
  cursor: number | 'end',
  limit: number,
  before = Number.MAX_SAFE_INTEGER,
) {
  const rows = messageRows(db, id);
  const visible = rows.filter((r) =>
    ['user', 'assistant', 'system'].includes(r.type),
  );
  const bound = Math.min(visible.length, before);
  const start =
    cursor === 'end' ? Math.max(0, bound - limit) : Math.min(cursor, bound);
  const end = Math.min(start + limit, bound);
  const pagination = {
    end,
    cursor: start,
    prevCursor: start > 0 ? Math.max(0, start - limit) : null,
    nextCursor: start + limit < visible.length ? start + limit : null,
    totalMessages: visible.length,
  };
  const selected = visible.slice(start, end);
  if (!selected.length) return { messages: [], ordinals: [], ...pagination };
  // Core pages by byte offset, while the public API retains its message ordinal cursor.
  const wanted = new Set(selected.map((r) => r.uuid));
  const page: ReturnType<typeof getMessages> = [];
  let offset = selected[0]!.byteOffset - 1;
  while (offset < selected.at(-1)!.byteOffset) {
    const batch = getMessages(db, id, { cursor: offset, limit: 1000 });
    if (!batch.length) break;
    page.push(...batch.filter((r) => wanted.has(r.uuid)));
    offset = batch.at(-1)!.byteOffset;
  }
  const uuids = page.map((r) => r.uuid);
  const raw = await readRawRecords(db, id, uuids);
  if (raw.length !== uuids.length) return null;
  const records = raw.map(parseRecord);
  // The index stores tool-use IDs but not tool-result IDs. Read result candidates
  // in bounded batches until all page tools have results, retaining only matches.
  const pending = new Set(
    selected.flatMap((r) =>
      Object.entries(r.toolUses)
        .filter(([, name]) => ['Edit', 'MultiEdit', 'Write'].includes(name))
        .map(([id]) => id),
    ),
  );
  const candidates = pending.size
    ? rows.filter(
        (r) =>
          r.type === 'user' &&
          r.byteOffset > selected[0]!.byteOffset &&
          !wanted.has(r.uuid),
      )
    : [];
  const acceptResults = (record: ReturnType<typeof parseRecord>) => {
    if (record.type !== 'user' || !('message' in record)) return false;
    const message = record.message as { content?: unknown };
    if (!Array.isArray(message.content)) return false;
    let matched = false;
    for (const block of message.content as {
      type?: string;
      tool_use_id?: string;
    }[]) {
      if (
        block.type === 'tool_result' &&
        block.tool_use_id &&
        pending.delete(block.tool_use_id)
      )
        matched = true;
    }
    return matched;
  };
  for (const record of records) acceptResults(record);
  for (let i = 0; pending.size && i < candidates.length; i += 100) {
    const extra = await readRawRecords(
      db,
      id,
      candidates.slice(i, i + 100).map((r) => r.uuid),
    );
    for (const record of extra.map(parseRecord))
      if (acceptResults(record)) records.push(record);
  }
  const mapped = messages(records);
  const ordinals: number[] = [];
  const result = selected.flatMap((row, ordinal) => {
    const index = uuids.indexOf(row.uuid);
    const record = records[index];
    const uuid =
      record && typeof record.uuid === 'string'
        ? record.uuid
        : `record-${index}`;
    const message = mapped.find((m) => m.uuid === uuid);
    if (!message) return [];
    if (record && typeof record.uuid !== 'string')
      message.uuid = `record-${rows.findIndex((r) => r.uuid === row.uuid)}`;
    ordinals.push(start + ordinal);
    return [message];
  });
  return {
    messages: result,
    ordinals,
    ...pagination,
  };
}

function sessionModels(
  db: IndexDatabase,
  id?: string,
  includeChildren = false,
) {
  const rows = db.sqlite
    .prepare(
      `WITH ranked AS (
    SELECT *, row_number() OVER (PARTITION BY sessionId, coalesce(messageId,uuid) ORDER BY (usage IS NOT NULL) DESC, byteOffset DESC) AS rank
    FROM messages WHERE ${id === undefined ? 'sessionId IN (SELECT id FROM sessions WHERE isSubagent=0 OR parentSessionId IN (SELECT id FROM sessions WHERE isSubagent=0))' : includeChildren ? 'sessionId IN (SELECT id FROM sessions WHERE id=? OR parentSessionId=?)' : 'sessionId=?'} AND type='assistant'
  ) SELECT model, sum(coalesce(json_extract(usage,'$.input'),0)) AS input,
    sum(coalesce(json_extract(usage,'$.output'),0)) AS output,
    sum(coalesce(json_extract(usage,'$.cacheRead'),0)) AS cacheRead,
    sum(coalesce(json_extract(usage,'$.cacheCreation'),0)) AS cacheCreation,
    sum(coalesce(json_extract(usage,'$.thinking'),0)) AS thinking,
    sum(costUsd) AS costUsd FROM ranked WHERE rank=1 GROUP BY model ORDER BY min(byteOffset)`,
    )
    .all(
      ...(id === undefined ? [] : includeChildren ? [id, id] : [id]),
    ) as (import('@c9view/api').TokenTotals & {
    model: string;
    costUsd: number;
  })[];
  return rows.map((r) => ({
    model: r.model,
    tokens: tokens(r),
    costUsd: r.costUsd,
  }));
}

/** One grouped query for all parents; session totals deliberately retain copied
 * history per file, matching the cards and the file-backed reader. */
export function subagentTotals(db: IndexDatabase) {
  const rows = db.sqlite
    .prepare(
      `SELECT parentSessionId, count(*) AS count,
    sum(input) AS input, sum(output) AS output, sum(cacheRead) AS cacheRead,
    sum(cacheCreation) AS cacheCreation, sum(thinking) AS thinking,
    sum(costUsd) AS costUsd FROM sessions WHERE isSubagent=1 GROUP BY parentSessionId`,
    )
    .all() as (import('@c9view/api').TokenTotals & {
    parentSessionId: string;
    count: number;
    costUsd: number;
  })[];
  return new Map(
    rows.map((r) => [
      r.parentSessionId,
      { count: r.count, tokens: tokens(r), costUsd: r.costUsd },
    ]),
  );
}

export function indexedModels(db: IndexDatabase, id?: string) {
  return sessionModels(db, id, true);
}

/** Server-side FTS query adds safe prefix matching and offset pagination that the
 * core literal-word search does not expose. All values use bound parameters. */
export function searchMessages(
  db: IndexDatabase,
  expression: string,
  filters: { projectId?: string; from?: string; to?: string; model?: string },
  limit: number,
  cursor: number,
) {
  const where = [
    'm.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)',
  ];
  const args: (string | number)[] = [expression];
  for (const [sql, value] of [
    ['s.projectId = ?', filters.projectId],
    ['m.timestamp >= ?', filters.from],
    ['substr(m.timestamp,1,10) <= ?', filters.to?.slice(0, 10)],
    ['m.model = ?', filters.model],
  ])
    if (value !== undefined) {
      where.push(sql!);
      args.push(value);
    }
  return db.sqlite
    .prepare(
      `SELECT m.uuid,m.sessionId,m.timestamp,m.role,m.model,m.text,s.projectId
    FROM messages m JOIN sessions s ON s.id=m.sessionId WHERE ${where.join(' AND ')}
    ORDER BY m.timestamp,m.uuid LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, cursor) as {
    projectId: string;
    sessionId: string;
    uuid: string;
    timestamp: string | null;
    role: string | null;
    model: string | null;
    text: string;
  }[];
}

/** Core's listSessions reads a project at a time and includes child rows. This
 * snapshot query loads all top-level rows once, without per-session lookups. */
export function snapshotSessions(db: IndexDatabase): IndexedSession[] {
  type JsonFields =
    | 'models'
    | 'permissionModes'
    | 'toolUseCounts'
    | 'cwdCounts'
    | 'unknownTypes';
  const rows = db.sqlite
    .prepare('SELECT * FROM sessions WHERE isSubagent=0 ORDER BY projectId,id')
    .all() as (Omit<IndexedSession, JsonFields | 'isSubagent'> &
    Record<JsonFields, string> & { isSubagent: number })[];
  return rows.map((row) => ({
    ...row,
    isSubagent: false,
    models: JSON.parse(row.models) as string[],
    permissionModes: JSON.parse(row.permissionModes) as string[],
    toolUseCounts: JSON.parse(row.toolUseCounts) as Record<string, number>,
    cwdCounts: JSON.parse(row.cwdCounts) as Record<string, number>,
    unknownTypes: JSON.parse(row.unknownTypes) as Record<string, number>,
  }));
}

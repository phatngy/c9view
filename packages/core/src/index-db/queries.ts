import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import { open } from 'node:fs/promises';
import type { IndexDatabase } from './indexer.js';
import { projects, sessions, messages, usageDaily } from './schema.js';
import { redactValue } from '../redact/index.js';
export const listProjects = (db: IndexDatabase) =>
  db.orm.select().from(projects).orderBy(projects.id).all();
export const getProject = (db: IndexDatabase, id: string) =>
  db.orm.select().from(projects).where(eq(projects.id, id)).get();
export const listSessions = (db: IndexDatabase, projectId: string) =>
  db.orm
    .select()
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(sessions.id)
    .all();
export const getSession = (db: IndexDatabase, id: string) =>
  db.orm.select().from(sessions).where(eq(sessions.id, id)).get();
export interface MessagePageOptions {
  cursor?: number;
  limit?: number;
}
function limit(value: number | undefined) {
  return Number.isFinite(value)
    ? Math.min(1000, Math.max(1, Math.floor(value!)))
    : 100;
}
/** Cursor is the byteOffset of the last returned record. */
export function getMessages(
  db: IndexDatabase,
  sessionId: string,
  options: MessagePageOptions = {},
) {
  return db.orm
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        options.cursor === undefined
          ? undefined
          : gt(messages.byteOffset, options.cursor),
      ),
    )
    .orderBy(messages.byteOffset)
    .limit(limit(options.limit))
    .all();
}
export async function readRawRecords(
  db: IndexDatabase,
  sessionId: string,
  uuids: readonly string[],
): Promise<unknown[]> {
  const session = getSession(db, sessionId);
  if (!session) return [];
  const handle = await open(session.file, 'r');
  const result: unknown[] = [];
  try {
    const info = await handle.stat();
    if (
      `${info.dev}:${info.ino}:${info.birthtimeMs}` !== session.fileIdentity ||
      info.size < session.fileSize ||
      (info.size === session.fileSize && info.mtimeMs !== session.fileMtimeMs)
    )
      return [];
    for (const uuid of uuids) {
      const row = db.orm
        .select()
        .from(messages)
        .where(and(eq(messages.sessionId, sessionId), eq(messages.uuid, uuid)))
        .get();
      if (!row) continue;
      const buffer = Buffer.alloc(row.byteLength);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        row.byteOffset,
      );
      if (bytesRead !== buffer.length) continue;
      try {
        const raw: unknown = JSON.parse(buffer.toString('utf8'));
        if (
          raw &&
          typeof raw === 'object' &&
          (!('uuid' in raw) || raw.uuid === uuid)
        )
          result.push(redactValue(raw));
      } catch {
        /* File changed since indexing. */
      }
    }
  } finally {
    await handle.close();
  }
  return result;
}
export interface UsageFilters {
  projectId?: string;
  from?: string;
  to?: string;
  model?: string;
  limit?: number;
}
export function search(
  db: IndexDatabase,
  query: string,
  options: UsageFilters = {},
) {
  query = query.replace(/\p{Cc}/gu, '');
  if (!query.trim()) return [];
  // Treat input as literal words; do not expose FTS query syntax to callers.
  const expression = query
    .trim()
    .split(/\s+/u)
    .map((word) => '"' + word.replaceAll('"', '""') + '"')
    .join(' AND ');
  try {
    return db.orm
      .select({ message: messages, projectId: sessions.projectId })
      .from(messages)
      .innerJoin(sessions, eq(sessions.id, messages.sessionId))
      .where(
        and(
          sql`messages.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ${expression})`,
          options.projectId
            ? eq(sessions.projectId, options.projectId)
            : undefined,
          options.from
            ? sql`${messages.timestamp} >= ${options.from}`
            : undefined,
          options.to
            ? sql`substr(${messages.timestamp},1,10) <= ${options.to.slice(0, 10)}`
            : undefined,
          options.model ? eq(messages.model, options.model) : undefined,
        ),
      )
      .orderBy(messages.timestamp, messages.uuid)
      .limit(limit(options.limit))
      .all();
  } catch {
    return [];
  }
}
function usage(db: IndexDatabase, group: SQL, options: UsageFilters) {
  return db.orm
    .select({
      key: group,
      input: sql<number>`sum(${usageDaily.input})`,
      output: sql<number>`sum(${usageDaily.output})`,
      cacheRead: sql<number>`sum(${usageDaily.cacheRead})`,
      cacheCreation: sql<number>`sum(${usageDaily.cacheCreation})`,
      thinking: sql<number>`sum(${usageDaily.thinking})`,
      costUsd: sql<number>`sum(${usageDaily.costUsd})`,
    })
    .from(usageDaily)
    .where(
      and(
        options.projectId
          ? eq(usageDaily.projectId, options.projectId)
          : undefined,
        options.from
          ? sql`${usageDaily.date} >= ${options.from.slice(0, 10)}`
          : undefined,
        options.to
          ? sql`${usageDaily.date} <= ${options.to.slice(0, 10)}`
          : undefined,
        options.model ? eq(usageDaily.model, options.model) : undefined,
      ),
    )
    .groupBy(group)
    .orderBy(group)
    .all();
}
export const usageByDay = (db: IndexDatabase, options: UsageFilters = {}) =>
  usage(db, sql<string>`${usageDaily.date}`, options).map(
    ({ key, ...rest }) => ({ date: key as string, ...rest }),
  );
export const usageByModel = (db: IndexDatabase, options: UsageFilters = {}) =>
  usage(db, sql<string>`${usageDaily.model}`, options).map(
    ({ key, ...rest }) => ({ model: key as string, ...rest }),
  );

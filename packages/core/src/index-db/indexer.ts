import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { assertClaudeDir, assertIndexPath } from './paths.js';
import { open, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as schema from './schema.js';
import { migrationSql, schemaVersion } from './migration.js';
import { discoverProjects, resolveProjectPath } from '../projects/index.js';
import {
  parseRecord,
  knownTranscriptRecordSchema,
  isAssistantRecord,
  isUserRecord,
  summarizeSession,
  extractUsage,
  emptyUsage,
  addUsage,
  listSubagents,
} from '../transcript/index.js';
import {
  loadPrices,
  resolvePrice,
  costOf,
  type PriceTable,
} from '../pricing/index.js';
import { redactText } from '../redact/index.js';
import type { loadConfig } from '../config/index.js';

export type IndexConfig = ReturnType<typeof loadConfig>;
export interface IndexDatabase {
  sqlite: Database.Database;
  orm: BetterSQLite3Database<typeof schema>;
  close(): void;
}
export function openIndex(dbPath: string, claudeDir?: string): IndexDatabase {
  if (claudeDir) assertIndexPath(dbPath, claudeDir);
  if (dbPath !== ':memory:')
    mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const version = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE name='meta'")
    .get()
    ? (
        sqlite
          .prepare("SELECT value FROM meta WHERE key='schemaVersion'")
          .get() as { value: string } | undefined
      )?.value
    : undefined;
  if (version !== schemaVersion)
    sqlite.transaction(() => {
      sqlite.exec(
        'DROP TRIGGER IF EXISTS messages_ai; DROP TRIGGER IF EXISTS messages_ad; DROP TRIGGER IF EXISTS messages_au; DROP TABLE IF EXISTS messages_fts; DROP TABLE IF EXISTS usage_daily; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS meta;',
      );
      sqlite.exec(migrationSql);
      sqlite
        .prepare('INSERT INTO meta VALUES (?,?)')
        .run('schemaVersion', schemaVersion);
    })();
  return {
    sqlite,
    orm: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}

export function setMeta(db: IndexDatabase, key: string, value: unknown) {
  db.orm
    .insert(schema.meta)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: schema.meta.key,
      set: { value: JSON.stringify(value) },
    })
    .run();
}
export interface IndexSessionOptions {
  prices?: PriceTable;
  projectId?: string;
  isSubagent?: boolean;
  parentSessionId?: string;
  parentToolUseId?: string;
  deferAggregates?: boolean;
}

export async function indexSession(
  db: IndexDatabase,
  file: string,
  options: IndexSessionOptions = {},
) {
  const prices = options.prices ?? (await loadPrices());
  const info = await stat(file);
  const isSubagent =
    options.isSubagent ?? path.basename(path.dirname(file)) === 'subagents';
  const parentSessionId =
    options.parentSessionId ??
    (isSubagent ? path.basename(path.dirname(path.dirname(file))) : undefined);
  const projectDir = isSubagent
    ? path.dirname(path.dirname(path.dirname(file)))
    : path.dirname(file);
  const projectId = options.projectId ?? path.basename(projectDir);
  const id = isSubagent
    ? `${parentSessionId}/${path.basename(file, '.jsonl')}`
    : path.basename(file, '.jsonl');
  const parentToolUseId =
    options.parentToolUseId ??
    (isSubagent && !options.projectId
      ? (await listSubagents(projectDir, parentSessionId!)).find(
          (a) => a.path === file,
        )?.parentToolUseId
      : undefined);
  const old = db.orm
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get();
  const handle = await open(file, 'r');
  let prefixHash: string;
  let tailHash: string;
  try {
    const b = Buffer.alloc(
      Math.min(old?.byteOffset ?? info.size, 4096, info.size),
    );
    await handle.read(b, 0, b.length, 0);
    prefixHash = createHash('sha256').update(b).digest('hex');
    const tail = Buffer.alloc(
      Math.min(old?.byteOffset ?? info.size, 64, info.size),
    );
    await handle.read(
      tail,
      0,
      tail.length,
      Math.max(
        0,
        Math.min(old?.byteOffset ?? info.size, info.size) - tail.length,
      ),
    );
    tailHash = createHash('sha256').update(tail).digest('hex');
  } finally {
    await handle.close();
  }
  const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
  const resume =
    old &&
    old.file === file &&
    old.fileIdentity === identity &&
    info.size >= old.fileSize &&
    old.prefixHash === prefixHash &&
    old.tailHash === tailHash &&
    (info.size > old.fileSize || info.mtimeMs === old.fileMtimeMs);
  if (
    resume &&
    info.size === old.fileSize &&
    info.mtimeMs === old.fileMtimeMs
  ) {
    if (parentToolUseId)
      db.orm
        .update(schema.sessions)
        .set({ parentToolUseId: parentToolUseId })
        .where(eq(schema.sessions.id, id))
        .run();
    return id;
  }
  const from = resume ? old.byteOffset : 0;
  let offset = from,
    malformed = resume ? old.malformed : 0;
  const unknownTypes: Record<string, number> = resume
    ? { ...old.unknownTypes }
    : {};
  const cwdCounts: Record<string, number> = resume ? { ...old.cwdCounts } : {};
  const records: ReturnType<typeof parseRecord>[] = [];
  const rows: (typeof schema.messages.$inferInsert)[] = [];
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, {
    start: from,
    end: Math.max(0, info.size - 1),
  })) {
    pending = Buffer.concat([pending, chunk as Buffer]);
    let start = 0;
    for (
      let end = pending.indexOf(10);
      end !== -1;
      end = pending.indexOf(10, start)
    ) {
      const bytes = pending.subarray(start, end);
      const byteOffset = offset;
      const byteLength = bytes.length + 1;
      offset += byteLength;
      start = end + 1;
      if (!bytes.toString('utf8').trim()) continue;
      let json: unknown;
      try {
        json = JSON.parse(bytes.toString('utf8'));
      } catch {
        malformed++;
        continue;
      }
      if (
        !json ||
        typeof json !== 'object' ||
        !('type' in json) ||
        typeof json.type !== 'string'
      ) {
        malformed++;
        continue;
      }
      const record = parseRecord(json);
      if (
        (record.type === 'user' || record.type === 'assistant') &&
        !knownTranscriptRecordSchema.safeParse(record).success
      ) {
        malformed++;
        continue;
      }
      records.push(record);
      if (typeof record.cwd === 'string')
        cwdCounts[record.cwd] = (cwdCounts[record.cwd] ?? 0) + 1;
      if (
        ![
          'user',
          'assistant',
          'ai-title',
          'permission-mode',
          'system',
          'attachment',
          'last-prompt',
          'mode',
          'file-history-snapshot',
          'file-history-delta',
          'bridge-session',
          'api-request',
          'api-request-blob',
          'api-request-shape',
          'atis-latch',
          'progress',
          'queue-operation',
          'summary',
        ].includes(record.type)
      )
        unknownTypes[record.type] = (unknownTypes[record.type] ?? 0) + 1;
      const assistant = isAssistantRecord(record),
        user = isUserRecord(record);
      const message = assistant || user ? record.message : undefined;
      const content = message?.content;
      const blocks = Array.isArray(content) ? content : [];
      const toolUses: Record<string, string> = {};
      for (const b of blocks)
        if (
          b.type === 'tool_use' &&
          typeof b.id === 'string' &&
          typeof b.name === 'string'
        )
          toolUses[b.id] = b.name;
      const usage =
        assistant && record.message.usage
          ? extractUsage(record.message.usage)
          : null;
      const price = assistant
        ? resolvePrice(prices, record.message.model)
        : null;
      rows.push({
        uuid:
          typeof record.uuid === 'string' ? record.uuid : `${id}:${byteOffset}`,
        sessionId: id,
        parentUuid:
          typeof record.parentUuid === 'string' ? record.parentUuid : null,
        type: record.type,
        role: message?.role ?? (assistant ? 'assistant' : user ? 'user' : null),
        timestamp:
          typeof record.timestamp === 'string' ? record.timestamp : null,
        model: assistant ? record.message.model : null,
        messageId: assistant ? record.message.id : null,
        isSidechain: record.isSidechain === true,
        isMeta: record.isMeta === true,
        text: redactText(
          typeof content === 'string'
            ? content
            : blocks
                .filter((b) => b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text)
                .join('\n'),
        ).slice(0, 20000),
        toolNames: Object.values(toolUses),
        toolUses,
        usage,
        costUsd:
          usage && price
            ? costOf(
                {
                  ...usage,
                  cacheCreation5m: assistant
                    ? (record.message.usage?.cache_creation
                        ?.ephemeral_5m_input_tokens ??
                      Math.max(0, usage.cacheCreation - usage.cacheCreation1h))
                    : 0,
                },
                price.price,
              )
            : 0,
        errorCount: blocks.filter(
          (b) => b.type === 'tool_result' && b.is_error === true,
        ).length,
        byteOffset,
        byteLength,
      });
    }
    pending = Buffer.from(pending.subarray(start));
  }
  const summary = summarizeSession(records);
  // Hash only committed bytes: partial tails can change before the next newline.
  const prefixHandle = await open(file, 'r');
  try {
    const b = Buffer.alloc(Math.min(offset, 4096));
    await prefixHandle.read(b, 0, b.length, 0);
    prefixHash = createHash('sha256').update(b).digest('hex');
    const tail = Buffer.alloc(Math.min(offset, 64));
    await prefixHandle.read(tail, 0, tail.length, offset - tail.length);
    tailHash = createHash('sha256').update(tail).digest('hex');
  } finally {
    await prefixHandle.close();
  }
  db.sqlite.transaction(() => {
    if (!resume)
      db.orm.delete(schema.sessions).where(eq(schema.sessions.id, id)).run();
    if (
      !db.orm
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .get()
    )
      db.orm
        .insert(schema.projects)
        .values({
          id: projectId,
          dir: projectDir,
          path: '',
          pathExists: false,
          pathSource: 'decoded',
        })
        .run();
    const previous = resume ? old : undefined;
    const values = {
      id,
      projectId,
      file,
      fileSize: info.size,
      fileMtimeMs: info.mtimeMs,
      fileIdentity: identity,
      prefixHash,
      tailHash,
      byteOffset: offset,
      title:
        previous?.title &&
        !records.some(
          (r) =>
            r.type === 'ai-title' &&
            typeof r.aiTitle === 'string' &&
            r.aiTitle.trim(),
        )
          ? previous.title
          : summary.title
            ? redactText(summary.title)
            : (previous?.title ?? null),
      firstAt:
        [previous?.firstAt, summary.firstAt]
          .filter((v): v is string => !!v)
          .sort()[0] ?? null,
      lastAt:
        [previous?.lastAt, summary.lastAt]
          .filter((v): v is string => !!v)
          .sort()
          .at(-1) ?? null,
      cwd: summary.cwd ?? previous?.cwd ?? null,
      cwdCounts,
      gitBranch: summary.gitBranches.at(-1) ?? previous?.gitBranch ?? null,
      version: summary.version ?? previous?.version ?? null,
      models: [...new Set([...(previous?.models ?? []), ...summary.models])],
      permissionModes: [
        ...new Set([
          ...(previous?.permissionModes ?? []),
          ...summary.permissionModes,
        ]),
      ],
      malformed,
      unknownTypes,
      isSubagent,
      parentSessionId: parentSessionId ?? null,
      parentToolUseId: parentToolUseId ?? previous?.parentToolUseId ?? null,
    };
    db.orm
      .insert(schema.sessions)
      .values(values)
      .onConflictDoUpdate({ target: schema.sessions.id, set: values })
      .run();
    for (const row of rows)
      db.orm
        .insert(schema.messages)
        .values(row)
        .onConflictDoUpdate({
          target: [schema.messages.sessionId, schema.messages.uuid],
          set: row,
        })
        .run();
    recomputeSession(db, id);
    if (!options.deferAggregates) recomputeProjects(db, prices, projectId);
  })();
  if (!options.deferAggregates) await refreshProjectPath(db, projectId);
  return id;
}

export async function refreshProjectPath(db: IndexDatabase, projectId: string) {
  const hints = db.orm
    .select({ counts: schema.sessions.cwdCounts })
    .from(schema.sessions)
    .where(eq(schema.sessions.projectId, projectId))
    .all()
    .flatMap((s) =>
      Object.entries(s.counts).flatMap(([cwd, count]) =>
        Array<string>(count).fill(cwd),
      ),
    );
  const resolved = await resolveProjectPath(projectId, { cwdHints: hints });
  db.orm
    .update(schema.projects)
    .set({
      path: resolved.path,
      pathExists: resolved.exists,
      pathSource: resolved.source,
    })
    .where(eq(schema.projects.id, projectId))
    .run();
}

function recomputeSession(db: IndexDatabase, id: string) {
  const rows = db.orm
    .select({
      uuid: schema.messages.uuid,
      type: schema.messages.type,
      messageId: schema.messages.messageId,
      toolUses: schema.messages.toolUses,
      errorCount: schema.messages.errorCount,
      usage: schema.messages.usage,
      costUsd: schema.messages.costUsd,
      timestamp: schema.messages.timestamp,
      model: schema.messages.model,
    })
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, id))
    .orderBy(schema.messages.byteOffset)
    .all();
  let total = emptyUsage(),
    costUsd = 0,
    messageCount = 0,
    errorCount = 0;
  const dedupe = new Map<string, (typeof rows)[number]>(),
    tools = new Map<string, string>();
  for (const r of rows) {
    if (r.type === 'user') messageCount++;
    if (
      r.type === 'assistant' &&
      (r.usage || !dedupe.has(r.messageId ?? r.uuid))
    )
      dedupe.set(r.messageId ?? r.uuid, r);
    for (const [key, value] of Object.entries(r.toolUses))
      tools.set(key, value);
    errorCount += r.errorCount;
  }
  messageCount += dedupe.size;
  for (const r of dedupe.values()) {
    if (!r.usage) continue;
    total = addUsage(total, r.usage);
    costUsd += r.costUsd;
  }
  const toolUseCounts: Record<string, number> = {};
  for (const name of tools.values())
    toolUseCounts[name] = (toolUseCounts[name] ?? 0) + 1;
  db.orm
    .update(schema.sessions)
    .set({
      input: total.input,
      output: total.output,
      cacheRead: total.cacheRead,
      cacheCreation: total.cacheCreation,
      thinking: total.thinking,
      costUsd,
      messageCount,
      errorCount,
      toolUseCounts,
    })
    .where(eq(schema.sessions.id, id))
    .run();
}
export function recomputeProjects(
  db: IndexDatabase,
  prices: PriceTable,
  projectId?: string,
) {
  // Copied resume/fork history counts once per project by message.id. Session
  // totals remain per file. Choose a stable session, then its latest usage row,
  // so scan order cannot change project/overview/daily totals.
  const where = projectId === undefined ? '' : ' WHERE s.projectId = ?';
  const params = projectId === undefined ? [] : [projectId];
  db.sqlite
    .prepare(
      `DELETE FROM usage_daily${projectId === undefined ? '' : ' WHERE projectId = ?'}`,
    )
    .run(...params);
  db.sqlite
    .prepare(
      `WITH ranked AS (
    SELECT m.*, s.projectId, row_number() OVER (
      PARTITION BY s.projectId, coalesce(m.messageId, json_array(m.sessionId,m.uuid))
      ORDER BY m.sessionId, m.byteOffset DESC
    ) AS rank FROM messages m JOIN sessions s ON s.id=m.sessionId
    ${where}${where ? ' AND' : ' WHERE'} m.type='assistant' AND m.usage IS NOT NULL
  ) INSERT INTO usage_daily (date,projectId,model,sessionId,input,output,cacheRead,cacheCreation,thinking,costUsd)
    SELECT coalesce(substr(timestamp,1,10),''), projectId, coalesce(model,'unknown'),sessionId,
    sum(json_extract(usage,'$.input')),sum(json_extract(usage,'$.output')),
    sum(json_extract(usage,'$.cacheRead')),sum(json_extract(usage,'$.cacheCreation')),
    sum(json_extract(usage,'$.thinking')),sum(costUsd)
    FROM ranked WHERE rank=1 GROUP BY 1,2,3,4`,
    )
    .run(...params);
  db.sqlite
    .prepare(
      `UPDATE projects SET sessionCount=(SELECT count(*) FROM sessions WHERE projectId=projects.id AND isSubagent=0), lastActivityAt=(SELECT max(lastAt) FROM sessions WHERE projectId=projects.id)${['input', 'output', 'cacheRead', 'cacheCreation', 'thinking', 'costUsd'].map((k) => `, ${k}=coalesce((SELECT sum(${k}) FROM usage_daily WHERE projectId=projects.id),0)`).join('')}${projectId === undefined ? '' : ' WHERE id = ?'}`,
    )
    .run(...params);
  const unknown: Record<string, number> = {};
  for (const s of db.orm
    .select({ unknown: schema.sessions.unknownTypes })
    .from(schema.sessions)
    .all())
    for (const [k, v] of Object.entries(s.unknown))
      unknown[k] = (unknown[k] ?? 0) + v;
  setMeta(db, 'unknownRecordTypes', unknown);
  const unpriced = db.orm
    .select({ model: schema.messages.model, count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(
      sql`${schema.messages.model} is not null and ${schema.messages.usage} is not null`,
    )
    .groupBy(schema.messages.model)
    .all();
  setMeta(
    db,
    'modelsWithoutPrice',
    Object.fromEntries(
      unpriced
        .filter((r) => !resolvePrice(prices, r.model!))
        .map((r) => [r.model, r.count]),
    ),
  );
}
export async function indexAll(db: IndexDatabase, config: IndexConfig) {
  assertClaudeDir(config.claudeDir);
  assertIndexPath(config.dbPath, config.claudeDir);
  const prices = await loadPrices();
  const discovered = await discoverProjects(config.claudeDir);
  const files = new Set<string>();
  const projects = new Set(discovered.map((p) => p.id));
  for (const project of discovered) {
    db.orm
      .insert(schema.projects)
      .values({
        id: project.id,
        dir: project.dir,
        path: '',
        pathExists: false,
        pathSource: 'decoded',
      })
      .onConflictDoUpdate({
        target: schema.projects.id,
        set: { dir: project.dir },
      })
      .run();
    for (const file of project.sessionFiles) {
      files.add(file.path);
      await indexSession(db, file.path, {
        projectId: project.id,
        prices,
        deferAggregates: true,
      });
      for (const agent of await listSubagents(project.dir, file.sessionId)) {
        files.add(agent.path);
        await indexSession(db, agent.path, {
          projectId: project.id,
          prices,
          deferAggregates: true,
          isSubagent: true,
          parentSessionId: file.sessionId,
          ...(agent.parentToolUseId
            ? { parentToolUseId: agent.parentToolUseId }
            : {}),
        });
      }
    }
    // Re-resolve on every scan, including unchanged sessions, so resolver fixes
    // update existing indexes without a schema bump or transcript rebuild.
    await refreshProjectPath(db, project.id);
  }
  db.sqlite.transaction(() => {
    for (const s of db.orm.select().from(schema.sessions).all())
      if (!files.has(s.file))
        db.orm
          .delete(schema.sessions)
          .where(eq(schema.sessions.id, s.id))
          .run();
    for (const p of db.orm.select().from(schema.projects).all())
      if (!projects.has(p.id))
        db.orm
          .delete(schema.projects)
          .where(eq(schema.projects.id, p.id))
          .run();
    recomputeProjects(db, prices);
    setMeta(db, 'lastFullScanAt', new Date().toISOString());
  })();
}

/** Remove one transcript and its child sessions without scanning other files. */
export function deleteSession(
  db: IndexDatabase,
  id: string,
  prices: PriceTable,
) {
  const session = db.orm
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .get();
  if (!session) return;
  db.sqlite.transaction(() => {
    db.sqlite
      .prepare('DELETE FROM sessions WHERE id = ? OR parentSessionId = ?')
      .run(id, id);
    recomputeProjects(db, prices, session.projectId);
  })();
}

import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';

const tokens = () => ({
  input: integer().notNull().default(0),
  output: integer().notNull().default(0),
  cacheRead: integer().notNull().default(0),
  cacheCreation: integer().notNull().default(0),
  thinking: integer().notNull().default(0),
  costUsd: real().notNull().default(0),
});
export const projects = sqliteTable('projects', {
  id: text().primaryKey(),
  dir: text().notNull(),
  path: text().notNull(),
  pathExists: integer({ mode: 'boolean' }).notNull(),
  pathSource: text().notNull(),
  sessionCount: integer().notNull().default(0),
  lastActivityAt: text(),
  ...tokens(),
});
export const sessions = sqliteTable(
  'sessions',
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    file: text().notNull(),
    fileSize: integer().notNull(),
    fileMtimeMs: real().notNull(),
    fileIdentity: text().notNull(),
    prefixHash: text().notNull(),
    tailHash: text().notNull(),
    byteOffset: integer().notNull().default(0),
    title: text(),
    firstAt: text(),
    lastAt: text(),
    cwd: text(),
    cwdCounts: text({ mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    gitBranch: text(),
    version: text(),
    models: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
    messageCount: integer().notNull().default(0),
    toolUseCounts: text({ mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    permissionModes: text({ mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    errorCount: integer().notNull().default(0),
    malformed: integer().notNull().default(0),
    unknownTypes: text({ mode: 'json' })
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    isSubagent: integer({ mode: 'boolean' }).notNull().default(false),
    parentSessionId: text(),
    parentToolUseId: text(),
    ...tokens(),
  },
  (t) => [index('sessions_project').on(t.projectId)],
);
export const messages = sqliteTable(
  'messages',
  {
    uuid: text().notNull(),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    parentUuid: text(),
    type: text().notNull(),
    role: text(),
    timestamp: text(),
    model: text(),
    messageId: text(),
    isSidechain: integer({ mode: 'boolean' }).notNull(),
    isMeta: integer({ mode: 'boolean' }).notNull(),
    text: text().notNull(),
    toolNames: text({ mode: 'json' }).$type<string[]>().notNull(),
    usage: text({ mode: 'json' }).$type<
      import('../transcript/usage.js').TokenUsage
    >(),
    byteOffset: integer().notNull(),
    byteLength: integer().notNull(),
    toolUses: text({ mode: 'json' })
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    errorCount: integer().notNull().default(0),
    costUsd: real().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.uuid] }),
    index('messages_session_offset').on(t.sessionId, t.byteOffset),
  ],
);
export const usageDaily = sqliteTable(
  'usage_daily',
  {
    date: text().notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    model: text().notNull(),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    ...tokens(),
  },
  (t) => [primaryKey({ columns: [t.date, t.projectId, t.model, t.sessionId] })],
);
export const meta = sqliteTable('meta', {
  key: text().primaryKey(),
  value: text().notNull(),
});

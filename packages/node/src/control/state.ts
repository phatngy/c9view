import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { constants, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkStateDirSync } from '@c9view/core';

const trustedFolders = sqliteTable('trusted_folders', {
  path: text().primaryKey(),
  fingerprint: text().notNull(),
  trustedAt: text('trusted_at').notNull(),
});

const sessionLabels = sqliteTable(
  'session_labels',
  {
    projectId: text('project_id').notNull(),
    sessionId: text('session_id').notNull(),
    label: text().notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.sessionId] })],
);

export interface LabelStore {
  labels(): { projectId: string; sessionId: string; label: string }[];
  /** An empty label removes it. */
  setLabel(projectId: string, sessionId: string, label: string): void;
}
export type ControlState = TrustState & LabelStore;

export interface TrustState {
  trusted(path: string, fingerprint: string): boolean;
  trust(path: string, fingerprint: string): void;
  close(): void;
}
/** Persistent state is never opened through the rebuildable index. */
export function openControlState(stateDir: string): ControlState {
  stateDir = resolve(stateDir);
  checkStateDirSync(stateDir);
  mkdirSync(stateDir, { mode: 0o700, recursive: true });
  checkStateDirSync(stateDir);
  const directory = join(stateDir, 'node');
  const check = (path: string, directory: boolean) => {
    const info = lstatSync(path);
    if (
      info.isSymbolicLink() ||
      (directory ? !info.isDirectory() : !info.isFile()) ||
      (process.getuid && info.uid !== process.getuid()) ||
      (info.mode & 0o777) !== (directory ? 0o700 : 0o600)
    )
      throw new Error('Unsafe control state permissions or owner');
  };
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  check(directory, true);
  const path = join(directory, 'state.db');
  // NOFOLLOW prevents a substituted file from being opened during creation.
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  closeSync(fd);
  check(path, false);
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      check(path + suffix, false);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const sqlite = new Database(path);
  // Idempotent initial migration; preserves existing trust records.
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS trusted_folders (path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, trusted_at TEXT NOT NULL)',
  );
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS session_labels (project_id TEXT NOT NULL, session_id TEXT NOT NULL, label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80), updated_at TEXT NOT NULL, PRIMARY KEY (project_id, session_id))',
  );
  const db = drizzle(sqlite);
  return {
    trusted: (path, fingerprint) =>
      !!db
        .select()
        .from(trustedFolders)
        .where(
          and(
            eq(trustedFolders.path, path),
            eq(trustedFolders.fingerprint, fingerprint),
          ),
        )
        .get(),
    trust: (path, fingerprint) => {
      const values = { path, fingerprint, trustedAt: new Date().toISOString() };
      db.insert(trustedFolders)
        .values(values)
        .onConflictDoUpdate({ target: trustedFolders.path, set: values })
        .run();
    },
    labels: () =>
      db
        .select()
        .from(sessionLabels)
        .all()
        .map(({ projectId, sessionId, label }) => ({
          projectId,
          sessionId,
          label,
        })),
    setLabel: (projectId, sessionId, label) => {
      if (!label) {
        db.delete(sessionLabels)
          .where(
            and(
              eq(sessionLabels.projectId, projectId),
              eq(sessionLabels.sessionId, sessionId),
            ),
          )
          .run();
        return;
      }
      const values = {
        projectId,
        sessionId,
        label,
        updatedAt: new Date().toISOString(),
      };
      db.insert(sessionLabels)
        .values(values)
        .onConflictDoUpdate({
          target: [sessionLabels.projectId, sessionLabels.sessionId],
          set: values,
        })
        .run();
    },
    close: () => sqlite.close(),
  };
}

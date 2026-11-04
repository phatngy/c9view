import { createRequire } from 'node:module';
import type * as Sqlite from 'node:sqlite';
import { constants, closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkStateDirSync } from '@c9view/core';

export interface TrustState {
  trusted(path: string, fingerprint: string): boolean;
  trust(path: string, fingerprint: string): void;
  close(): void;
}
/** Persistent state is never opened through the rebuildable index. */
export function openControlState(stateDir: string): TrustState {
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
  const { DatabaseSync } = createRequire(import.meta.url)(
    'node:sqlite',
  ) as typeof Sqlite;
  const db = new DatabaseSync(path);
  db.exec(
    'CREATE TABLE IF NOT EXISTS trusted_folders (path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, trusted_at TEXT NOT NULL)',
  );
  return {
    trusted: (path, fingerprint) =>
      !!db
        .prepare('SELECT 1 FROM trusted_folders WHERE path=? AND fingerprint=?')
        .get(path, fingerprint),
    trust: (path, fingerprint) => {
      db.prepare(
        'INSERT INTO trusted_folders VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint, trusted_at=excluded.trusted_at',
      ).run(path, fingerprint, new Date().toISOString());
    },
    close: () => db.close(),
  };
}

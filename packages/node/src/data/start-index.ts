import { openIndex, indexAll, watchClaudeDir, getSession } from '@c9view/core';
import { z } from 'zod';
import type { KanbanColumn } from '@c9view/api';
import type { DataStore, ServerConfig } from './store.js';

/** Returns immediately; ready/close are explicit for embedding and tests. */
export function startIndex(config: ServerConfig, store: DataStore) {
  store.events.emit({ event: 'index', data: { state: 'building' } });
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sessionProjects = new Map<string, string>();
  const columns = new Map<string, KanbanColumn>();
  let statusFlight = Promise.resolve();
  const status = (refresh = true) => {
    if (refresh) store.invalidate();
    clearTimeout(timer);
    timer = setTimeout(() => {
      statusFlight = statusFlight
        .then(async () => {
          if (closed) return;
          for (const p of await store.snapshot())
            for (const s of p.sessions) {
              const previous = columns.get(s.id);
              columns.set(s.id, s.status.column);
              if (previous !== undefined && previous !== s.status.column)
                store.events.emit({
                  event: 'status',
                  data: {
                    projectId: p.project.id,
                    sessionId: s.id,
                    column: s.status.column,
                  },
                });
            }
        })
        .catch(() => {});
    }, 250);
    timer.unref();
  };
  const unsubscribe = store.hooks.onUpdate(status);
  let watcher: ReturnType<typeof watchClaudeDir> | undefined;
  const fail = () => {
    store.indexHealth = { ...store.indexHealth, state: 'error' };
    store.invalidate();
    store.events.emit({ event: 'index', data: { state: 'error' } });
  };
  const ready = (async () => {
    try {
      const db = openIndex(config.dbPath, config.claudeDir);
      store.index = db;
      store.indexHealth = {
        state: 'building',
        lastFullScanAt: readLastFullScanAt(db),
      };
      watcher = watchClaudeDir(
        config,
        db,
        (change) => {
          if (change.kind === 'session') {
            const session = getSession(db, change.id);
            const projectId =
              session?.projectId ?? sessionProjects.get(change.id);
            if (projectId) {
              store.invalidate(projectId);
              sessionProjects.set(change.id, projectId);
              store.events.emit({
                event: 'session',
                data: { projectId, sessionId: change.id },
              });
            }
          } else if (change.kind === 'project') {
            store.invalidate(change.id);
            store.events.emit({
              event: 'project',
              data: { projectId: change.id },
            });
          } else if (change.kind === 'config')
            store.events.emit({ event: 'config', data: {} });
          else store.invalidate();
          status(false);
        },
        fail,
      );
      await watcher.ready;
      await indexAll(db, config);
      if (closed) return;
      for (const row of db.sqlite
        .prepare('SELECT id, projectId FROM sessions')
        .all() as { id: string; projectId: string }[])
        sessionProjects.set(row.id, row.projectId);
      // Report the timestamp indexAll stored, not a second clock read, so the
      // value is the same before and after a restart.
      store.indexHealth = {
        state: 'ready',
        lastFullScanAt: readLastFullScanAt(db) ?? new Date().toISOString(),
      };
      store.invalidate();
      for (const p of await store.snapshot())
        for (const s of p.sessions) {
          columns.set(s.id, s.status.column);
          sessionProjects.set(s.id, p.project.id);
        }
      store.events.emit({ event: 'index', data: { state: 'ready' } });
    } catch {
      fail();
    }
  })();
  let closeFlight: Promise<void> | undefined;
  return {
    ready,
    close() {
      return (closeFlight ??= (async () => {
        closed = true;
        unsubscribe();
        clearTimeout(timer);
        await ready;
        try {
          await watcher?.close();
          await statusFlight;
        } finally {
          store.hooks.close();
          store.index?.close();
          store.index = undefined;
        }
      })());
    },
  };
}

function readLastFullScanAt(db: {
  sqlite: { prepare(sql: string): { get(): unknown } };
}) {
  const row = db.sqlite
    .prepare("SELECT value FROM meta WHERE key='lastFullScanAt'")
    .get() as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = z.iso.datetime().safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    /* Invalid metadata is replaced by the next full scan. */
    return null;
  }
}

import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const watcher = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  db: undefined as import('@c9view/core').IndexDatabase | undefined,
}));
vi.mock('@c9view/core', async (original) => ({
  ...(await original<typeof import('@c9view/core')>()),
  watchClaudeDir: vi.fn((_config, db) => {
    watcher.db = db;
    return { ready: Promise.resolve(), close: watcher.close };
  }),
}));
vi.mock('@hono/node-server', () => ({
  serve: () => {
    const server = new EventEmitter();
    return Object.assign(server, {
      close: () => {
        server.emit('close');
      },
    });
  },
}));
import { startServer } from '../main.js';

it('returns the index handle and closes watcher and database on HTTP close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-lifecycle-'));
  try {
    await mkdir(join(dir, 'claude'));
    await writeFile(join(dir, 'index.html'), '<html></html>');
    const server = startServer({
      auth: 'none',
      claudeDir: join(dir, 'claude'),
      db: join(dir, 'index.sqlite'),
      webDist: dir,
    });
    await server.index.ready;
    expect(watcher.db?.sqlite.open).toBe(true);
    server.close();
    await server.index.close();
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(watcher.db?.sqlite.open).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

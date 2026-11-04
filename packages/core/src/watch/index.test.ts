import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { watchClaudeDir } from './index.js';
import { indexAll, openIndex } from '../index-db/indexer.js';
import { listProjects } from '../index-db/queries.js';

it('keeps state aliases out of the scan and watcher while indexing ordinary sessions', async () => {
  const home = await mkdtemp(join(tmpdir(), 'c9view-watch-state-'));
  const claudeDir = join(home, 'claude');
  const config = { claudeDir, dbPath: ':memory:', workspaceRoots: [] };
  const db = openIndex(':memory:');
  let watcher: ReturnType<typeof watchClaudeDir> | undefined;
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_STATE_HOME', join(home, 'xdg'));
  vi.stubEnv('C9VIEW_STATE_DIR', join(home, 'state-alias'));
  try {
    await mkdir(join(claudeDir, 'projects', 'ordinary'), { recursive: true });
    for (const name of ['c9view', 'my-state']) {
      const dir = join(claudeDir, name);
      await mkdir(dir);
      await writeFile(join(dir, 'private.jsonl'), '{}\n');
      await symlink(dir, join(claudeDir, 'projects', name));
    }
    await symlink(join(claudeDir, 'my-state'), join(home, 'state-alias'));
    await indexAll(db, config);
    expect(listProjects(db).map((p) => p.id)).toEqual(['ordinary']);
    const change = vi.fn(),
      error = vi.fn();
    watcher = watchClaudeDir(config, db, change, error);
    await watcher.ready;
    for (const name of ['c9view', 'my-state']) {
      await writeFile(join(claudeDir, name, 'new.jsonl'), '{}\n');
      await writeFile(join(claudeDir, name, 'settings.json'), '{}');
    }
    await writeFile(
      join(claudeDir, 'projects/ordinary/visible.jsonl'),
      JSON.stringify({
        type: 'user',
        uuid: 'synthetic',
        message: { content: 'synthetic' },
      }) + '\n',
    );
    await vi.waitFor(
      () =>
        expect(change).toHaveBeenCalledWith({ kind: 'session', id: 'visible' }),
      { timeout: 4000 },
    );
    expect(
      change.mock.calls.every(
        ([event]) => event.id === 'visible' || event.id === 'ordinary',
      ),
    ).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(listProjects(db).map((p) => p.id)).toEqual(['ordinary']);
  } finally {
    await watcher?.close();
    db.close();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }
});

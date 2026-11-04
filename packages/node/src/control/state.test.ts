import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, mkdir, stat, symlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openControlState } from './state.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it('T010 persists trust in a separate protected state db without experimental SQLite warnings', async () => {
  const warning = vi.spyOn(process, 'emitWarning');
  const root = await mkdtemp(join(tmpdir(), 'c9view-state-'));
  roots.push(root);
  const folder = join(root, 'state');
  let state = openControlState(folder);
  expect(state.trusted('/synthetic/project', 'abc')).toBe(false);
  state.trust('/synthetic/project', 'abc');
  state.close();
  state = openControlState(folder);
  expect(state.trusted('/synthetic/project', 'abc')).toBe(true);
  expect(state.trusted('/synthetic/project', 'changed')).toBe(false);
  state.close();
  expect(warning).not.toHaveBeenCalled();
  expect((await stat(folder)).mode & 0o777).toBe(0o700);
  expect((await stat(join(folder, 'node/state.db'))).mode & 0o777).toBe(0o600);
});
it('T010 refuses symlinks and unsafe permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c9view-state-'));
  roots.push(root);
  await mkdir(join(root, 'target'), { mode: 0o700 });
  await symlink(join(root, 'target'), join(root, 'state'));
  expect(() => openControlState(join(root, 'state'))).toThrow('symlink');
  await chmod(join(root, 'target'), 0o755);
  expect(() => openControlState(join(root, 'target'))).toThrow('permissions');
});

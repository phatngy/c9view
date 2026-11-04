import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'c9view-ignore-'));
  dirs.push(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('C9VIEW_STATE_DIR', undefined);
  return home;
}
import { isC9viewStatePath } from './ignore.js';
it('ignores canonical state paths, aliases and missing children with component boundaries', async () => {
  const home = await fixture(),
    claude = join(home, 'claude'),
    state = join(claude, 'my-state');
  await mkdir(state, { recursive: true });
  await mkdir(join(claude, 'c9view'));
  await symlink(state, join(home, 'alias'));
  await symlink(join(claude, 'c9view'), join(claude, 'alias'));
  expect(
    isC9viewStatePath(
      claude,
      join(home, 'alias'),
      join(state, 'missing/identity.json'),
    ),
  ).toBe(true);
  expect(
    isC9viewStatePath(claude, state, join(claude, 'alias/events.jsonl')),
  ).toBe(true);
  expect(
    isC9viewStatePath(claude, state, join(claude, 'c9viewish/events.jsonl')),
  ).toBe(false);
  expect(
    isC9viewStatePath(
      claude,
      join(home, 'outside'),
      join(home, 'outside/file'),
    ),
  ).toBe(false);
});

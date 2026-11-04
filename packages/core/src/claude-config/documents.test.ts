import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
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
import {
  readInstructions,
  readSkills,
  readAgents,
  readCommands,
} from './documents.js';
it.each(['c9view', 'my-state'])(
  'excludes state documents and instruction includes through symlinks: %s',
  async (name) => {
    const home = await fixture(),
      claude = join(home, 'claude'),
      state = join(claude, name);
    await mkdir(state, { recursive: true });
    vi.stubEnv('C9VIEW_STATE_DIR', join(home, 'state-alias'));
    await symlink(state, join(home, 'state-alias'));
    for (const kind of ['skills', 'agents', 'commands'])
      await mkdir(join(claude, kind));
    await writeFile(join(state, 'SKILL.md'), 'private state');
    await writeFile(join(state, 'private.md'), 'private state');
    await symlink(state, join(claude, 'skills', 'alias'));
    await symlink(
      join(state, 'private.md'),
      join(claude, 'agents', 'alias.md'),
    );
    await symlink(
      join(state, 'private.md'),
      join(claude, 'commands', 'alias.md'),
    );
    await writeFile(join(claude, 'CLAUDE.md'), `@${name}/private.md`);
    expect(await readSkills(join(claude, 'skills'), 'user')).toEqual([]);
    expect(await readAgents(join(claude, 'agents'), 'user')).toEqual([]);
    expect(await readCommands(join(claude, 'commands'), 'user')).toEqual([]);
    expect((await readInstructions(claude))[0]?.includes).toEqual([]);
  },
);

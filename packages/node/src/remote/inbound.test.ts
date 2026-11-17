import { afterEach, describe, expect, it } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inboundRule } from './inbound.js';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
async function setup(layers: {
  user?: unknown;
  userLocal?: unknown;
  project?: unknown;
  local?: unknown;
}) {
  const root = await mkdtemp(join(tmpdir(), 'c9inb-'));
  roots.push(root);
  const claudeDir = join(root, '.claude');
  const cwd = join(root, 'proj');
  await mkdir(claudeDir);
  await mkdir(join(cwd, '.claude'), { recursive: true });
  const write = (path: string, v: unknown) =>
    v === undefined
      ? Promise.resolve()
      : writeFile(path, typeof v === 'string' ? v : JSON.stringify(v));
  await write(join(claudeDir, 'settings.json'), layers.user);
  await write(join(claudeDir, 'settings.local.json'), layers.userLocal);
  await write(join(cwd, '.claude', 'settings.json'), layers.project);
  await write(join(cwd, '.claude', 'settings.local.json'), layers.local);
  return { claudeDir, cwd, root };
}
const v = (crossSessionInbound: unknown) => ({ crossSessionInbound });
const run = async (
  layers: Parameters<typeof setup>[0],
  mode: string | null = 'default',
) => {
  const s = await setup(layers);
  return inboundRule({
    claudeDir: s.claudeDir,
    cwd: s.cwd,
    mode: mode ?? undefined,
  });
};

describe('T033 inbound rule', () => {
  it('ignores <claudeDir>/settings.local.json', async () => {
    expect(await run({ userLocal: v('refuse') })).toBe('none');
    expect(await run({ user: v('hold'), userLocal: v('accept') })).toBe('hold');
  });
  it('user hold beats project and local accept', async () => {
    expect(await run({ user: v('hold'), project: v('accept') })).toBe('hold');
    expect(await run({ user: v('hold'), local: v('accept') })).toBe('hold');
  });
  it('user refuse is not loosened by a repo', async () => {
    expect(await run({ user: v('refuse'), project: v('hold') })).toBe('refuse');
  });
  it('repo hold or refuse tightens a user accept or nothing', async () => {
    expect(await run({ user: v('accept'), project: v('hold') })).toBe('hold');
    expect(await run({ user: v('accept'), local: v('refuse') })).toBe('refuse');
    expect(await run({ project: v('hold') })).toBe('hold');
    expect(await run({ project: v('hold'), local: v('refuse') })).toBe(
      'refuse',
    );
    expect(await run({ user: v('hold'), local: v('refuse') })).toBe('refuse');
  });
  it('repo accept alone changes nothing', async () => {
    expect(await run({ project: v('accept') }, 'bypassPermissions')).toBe(
      'may-hold',
    );
    expect(await run({ local: v('accept') }, 'default')).toBe('none');
  });
  it('an invalid value is hold, at any layer', async () => {
    expect(await run({ user: v('maybe') })).toBe('hold');
    expect(await run({ user: v(7) })).toBe('hold');
    expect(await run({ project: v(null) })).toBe('hold');
  });
  it('a layer that exists but cannot be parsed or read is hold', async () => {
    expect(await run({ user: '{ broken' })).toBe('hold');
    expect(await run({ local: '[1,2]' })).toBe('hold');
    const s = await setup({});
    const target = join(s.root, 'outside.json');
    await writeFile(target, JSON.stringify(v('accept')));
    await symlink(target, join(s.cwd, '.claude', 'settings.json'));
    expect(await inboundRule({ ...s, mode: 'default' })).toBe('hold');
    const s2 = await setup({});
    await mkdir(join(s2.cwd, '.claude', 'settings.local.json'));
    expect(await inboundRule({ ...s2, mode: 'default' })).toBe('hold');
    const s3 = await setup({ user: v('accept') });
    await chmod(join(s3.claudeDir, 'settings.json'), 0o000);
    if (process.getuid?.() !== 0)
      expect(await inboundRule({ ...s3, mode: 'default' })).toBe('hold');
  });
  it('a missing file is simply unset, a missing or relative cwd fails closed', async () => {
    const s = await setup({});
    expect(
      await inboundRule({ claudeDir: s.claudeDir, cwd: s.cwd, mode: 'plan' }),
    ).toBe('none');
    expect(
      await inboundRule({
        claudeDir: s.claudeDir,
        cwd: undefined,
        mode: 'plan',
      }),
    ).toBe('hold');
    expect(
      await inboundRule({ claudeDir: s.claudeDir, cwd: 'rel', mode: 'plan' }),
    ).toBe('hold');
  });
  it('refuse is a refusal', async () => {
    expect(await run({ user: v('refuse') })).toBe('refuse');
    expect(await run({ local: v('refuse') })).toBe('refuse');
  });
  it('unset: prompting modes give no warning, bypass or unknown gives may-hold', async () => {
    for (const m of ['default', 'acceptEdits', 'plan', 'auto'])
      expect(await run({}, m)).toBe('none');
    expect(await run({}, 'bypassPermissions')).toBe('may-hold');
    expect(await run({}, null)).toBe('may-hold');
    expect(await run({}, 'somethingNew')).toBe('may-hold');
  });
  it('an explicit accept gives no warning in any mode', async () => {
    for (const m of ['bypassPermissions', null, 'default'])
      expect(await run({ user: v('accept') }, m)).toBe('none');
  });
  it('explicit hold stays hold whatever the mode', async () => {
    expect(await run({ user: v('hold') }, 'default')).toBe('hold');
  });
  it('does not use the generic settings readers or merge', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('./inbound.ts', import.meta.url),
      'utf8',
    );
    const imports = source
      .split('\n')
      .filter((l) => /^\s*(import|\} from)/.test(l))
      .join('\n');
    expect(imports).not.toMatch(/readSettings|mergeSettings|settingSource/);
    expect(imports).toContain('readTextResult');
  });
});

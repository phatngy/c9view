import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mergeSettings,
  readAgents,
  readCommands,
  readInstructions,
  readMcpServers,
  readPlugins,
  readSettings,
  readSkills,
} from './index.js';
import { readJson, readText } from './shared.js';
const home = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => home.path,
}));
let root: string;
let claude: string;
let project: string;
async function file(path: string, content: string | object): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'c9view-security-'));
  home.path = root;
  claude = join(root, 'claude');
  project = join(root, 'project');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('file policy', () => {
  it.each([
    '.ssh/config',
    '.gnupg/config',
    '.aws/config',
    '.codex/config',
    '.config/config',
    '.kube/config',
    '.docker/config',
    '.claude.json',
    '.credentials.json',
    'auth.json',
    '.netrc',
    '.npmrc',
    '.pypirc',
    '.env',
    '.env.local',
    'id_rsa',
    'id_ed25519',
    'cert.pem',
    'cert.key',
  ])(
    'denies %s directly, through symlinks, and through shared reads',
    async (name) => {
      const target = join(project, name);
      await file(target, 'PRIVATE CONTENT');
      await symlink(target, join(project, 'alias.md'));
      await file(join(project, 'CLAUDE.md'), `@${name}\n@alias.md`);
      const tree = await readInstructions(claude, project);
      expect(tree[0]?.includes).toHaveLength(2);
      for (const node of tree[0]?.includes ?? []) {
        expect(node).toMatchObject({ denied: true, reason: 'sensitive path' });
        expect(node).not.toHaveProperty('content');
      }
      expect(JSON.stringify(tree)).not.toContain('PRIVATE CONTENT');
      expect(await readText(target)).toBeUndefined();
      expect(await readText(join(project, 'alias.md'))).toBeUndefined();
    },
  );
  it('reports denied names even if the target is missing', async () => {
    await file(join(project, 'CLAUDE.md'), '@.env.missing');
    const tree = await readInstructions(claude, project);
    expect(tree[0]?.includes[0]).toMatchObject({
      denied: true,
      reason: 'sensitive path',
    });
    expect(tree[0]?.includes[0]).not.toHaveProperty('content');
  });
  it('permits home includes for user scope while denying them for project scope', async () => {
    await file(join(root, 'notes.md'), 'home instructions');
    await file(join(claude, 'CLAUDE.md'), '@~/notes.md');
    await file(join(project, 'CLAUDE.md'), '@~/notes.md');
    const tree = await readInstructions(claude, project);
    expect(tree[0]?.includes[0]?.content).toBe('home instructions');
    expect(tree[1]?.includes[0]).toMatchObject({
      denied: true,
      reason: 'outside allowed roots',
    });
  });
  it('anchors nested includes to the project, including realpath escapes and sibling prefix traps', async () => {
    await file(
      join(project, 'CLAUDE.md'),
      '@docs/good.md\n@escape.md\n@../project-other/out.md\n@../claude/shared.md',
    );
    await file(join(project, 'docs/good.md'), '@../../outside.md');
    await file(join(root, 'outside.md'), 'PRIVATE CONTENT');
    await file(join(root, 'project-other/out.md'), 'PRIVATE CONTENT');
    await file(join(claude, 'shared.md'), 'shared instructions');
    await symlink(join(root, 'outside.md'), join(project, 'escape.md'));
    const tree = await readInstructions(claude, project);
    expect(tree[0]?.includes[0]?.includes[0]?.denied).toBe(true);
    expect(tree[0]?.includes.slice(1, 3).every((node) => node.denied)).toBe(
      true,
    );
    expect(tree[0]?.includes[3]?.content).toBe('shared instructions');
    expect(JSON.stringify(tree)).not.toContain('PRIVATE CONTENT');
  });
  it('rejects binary extensions and binary/invalid UTF-8 samples even under allowed roots', async () => {
    await file(join(project, 'CLAUDE.md'), '@blob.md\n@data.pdf\n@utf.md');
    await file(join(project, 'data.pdf'), 'apparently text');
    await writeFile(join(project, 'blob.md'), Buffer.from([0, 1, 2]));
    await writeFile(join(project, 'utf.md'), Buffer.from([0xff, 0xfe]));
    const tree = await readInstructions(claude, project);
    expect(tree[0]?.includes).toHaveLength(3);
    expect(
      tree[0]?.includes.every((node) => node.denied && !node.content),
    ).toBe(true);
  });
  it('applies the policy to settings, MCP, skills, agents, commands and JSON reads', async () => {
    await file(join(project, '.aws/data.json'), { secret: 'PRIVATE CONTENT' });
    await mkdir(join(claude, 'skills/test'), { recursive: true });
    await mkdir(join(claude, 'agents'), { recursive: true });
    await mkdir(join(claude, 'commands'), { recursive: true });
    for (const path of [
      'settings.json',
      '.mcp.json',
      'skills/test/SKILL.md',
      'agents/test.md',
      'commands/test.md',
    ])
      await symlink(join(project, '.aws/data.json'), join(claude, path));
    expect(await readSettings(claude)).toEqual([]);
    expect(await readMcpServers(claude)).toEqual([]);
    expect(await readSkills(join(claude, 'skills'), 'user')).toEqual([]);
    expect(await readAgents(join(claude, 'agents'), 'user')).toEqual([]);
    expect(await readCommands(join(claude, 'commands'), 'user')).toEqual([]);
    expect(await readJson(join(project, '.aws/data.json'))).toBeUndefined();
  });
});

describe('plugin and MCP inventory', () => {
  async function registry(installPath: string): Promise<void> {
    await file(join(claude, 'plugins/installed_plugins.json'), {
      plugins: { 'example@test': [{ installPath }] },
    });
  }
  it('redacts MCP command flags, URL credentials and query parameters, args, env and headers', async () => {
    await file(join(root, '.claude.json'), {
      mcpServers: {
        test: {
          command: 'x --api-key abc123xyz',
          args: ['--token', 'argument-secret'],
          env: { PUBLIC: 'environment-secret' },
          headers: { Custom: 'header-secret' },
          url: 'https://user:pass@example.test/p?key=abc123xyz',
        },
      },
    });
    const output = await readMcpServers(claude);
    expect(output).toHaveLength(1);
    for (const secret of [
      'abc123xyz',
      'argument-secret',
      'environment-secret',
      'header-secret',
      'user:pass',
    ])
      expect(JSON.stringify(output)).not.toContain(secret);
    expect(output[0]?.command).toBe('x --api-key «redacted:flag»');
  });
  it('recovers stale installations by semver, reads grouped skills, MCP and both manifest hook locations', async () => {
    const base = join(claude, 'plugins/cache/test/example');
    await registry(join(base, 'unknown'));
    for (const v of ['1.9.0', '1.10.0-rc.2', '1.10.0-rc.10', '1.10.0'])
      await file(join(base, v, 'skills/group/sample/SKILL.md'), 'nested skill');
    const install = join(base, '1.10.0');
    await file(join(install, 'skills/direct/SKILL.md'), 'direct skill');
    await file(
      join(install, 'skills/group/sample/ignored/SKILL.md'),
      'too deep',
    );
    await file(join(install, '.mcp.json'), {
      mcpServers: {
        test: { command: 'x --auth abc123xyz', env: { TEST: 'private-env' } },
      },
    });
    await file(join(install, 'hooks/hooks.json'), {
      hooks: { Stop: [{ type: 'command', command: 'x --token abc123xyz' }] },
    });
    await file(join(install, 'plugin.json'), {
      hooks: {
        Start: [{ type: 'http', url: 'https://example.test?token=abc123xyz' }],
      },
    });
    await file(join(install, '.claude-plugin/plugin.json'), {
      hooks: { Finish: [{ type: 'command', command: 'echo ok' }] },
    });
    const result = await readPlugins(claude);
    expect(result.plugins[0]?.installPath).toBe(install);
    expect(result.plugins[0]?.source.path).toBe(install);
    expect(result.plugins[0]?.skills).toHaveLength(2);
    expect(result.plugins[0]?.hooks).toHaveLength(3);
    expect(result.plugins[0]?.mcpServers).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('abc123xyz');
    expect(JSON.stringify(result)).not.toContain('private-env');
  });
  it('orders prereleases numerically and treats build metadata as a release', async () => {
    const base = join(claude, 'plugins/cache/test/example');
    await registry(join(base, 'unknown'));
    for (const v of ['1.0.0-rc.2', '1.0.0-rc.10'])
      await file(join(base, v, 'skills/sample/SKILL.md'), 'skill');
    expect((await readPlugins(claude)).plugins[0]?.installPath).toBe(
      join(base, '1.0.0-rc.10'),
    );
    await file(join(base, '1.0.0+build-2/skills/sample/SKILL.md'), 'skill');
    expect((await readPlugins(claude)).plugins[0]?.installPath).toBe(
      join(base, '1.0.0+build-2'),
    );
  });
  it('reads manifest hook file references without duplicating the standard hook file', async () => {
    const install = join(claude, 'plugins/cache/test/example/1.0.0');
    await registry(install);
    await file(join(install, 'hooks/hooks.json'), {
      hooks: { Stop: [{ type: 'command', command: 'echo safe' }] },
    });
    await file(join(install, '.claude-plugin/plugin.json'), {
      hooks: ['${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json'],
    });
    expect((await readPlugins(claude)).plugins[0]?.hooks).toHaveLength(1);
  });
  it('prefers an existing install path and otherwise uses mtime for non-semver caches', async () => {
    const base = join(claude, 'plugins/cache/test/example');
    await file(join(base, 'old/skills/test/SKILL.md'), 'old');
    await file(join(base, 'new/skills/test/SKILL.md'), 'new');
    await utimes(join(base, 'old'), 1, 1);
    await utimes(join(base, 'new'), 2, 2);
    await registry(join(base, 'old'));
    expect((await readPlugins(claude)).plugins[0]?.installPath).toBe(
      join(base, 'old'),
    );
    await registry(join(base, 'unknown'));
    expect((await readPlugins(claude)).plugins[0]?.installPath).toBe(
      join(base, 'new'),
    );
  });
  it('stops skill recursion at two levels below skills', async () => {
    const dir = join(claude, 'skills');
    await file(join(dir, 'one/two/three/SKILL.md'), 'too deep');
    expect(await readSkills(dir, 'user')).toEqual([]);
  });
});

it('reports mixed container scopes after merging, including concatenated permission arrays', () => {
  const merged = mergeSettings([
    {
      source: { scope: 'user', path: '' },
      data: {
        permissions: { allow: ['A'], deny: ['B'] },
        nested: { a: 1, b: 2 },
      },
    },
    {
      source: { scope: 'project', path: '' },
      data: { permissions: { allow: ['C'] }, nested: { b: 3 } },
    },
  ]);
  expect(merged.provenance).toMatchObject({
    '/permissions': 'mixed',
    '/permissions/allow': 'mixed',
    '/permissions/allow/0': 'user',
    '/permissions/allow/1': 'project',
    '/permissions/deny': 'user',
    '/nested': 'mixed',
    '/nested/a': 'user',
    '/nested/b': 'project',
  });
  expect(
    mergeSettings([
      { source: { scope: 'user', path: '' }, data: { nested: { a: 1 } } },
      { source: { scope: 'local', path: '' }, data: { nested: { a: 2 } } },
    ]).provenance['/nested'],
  ).toBe('local');
});

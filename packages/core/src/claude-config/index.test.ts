import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mergeSettings,
  parseFrontmatter,
  readAgents,
  readCommands,
  readHooks,
  readInstructions,
  readMcpServers,
  readPlugins,
  readSettings,
  readSkills,
  type SettingsLayer,
} from './index.js';

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
  root = await mkdtemp(join(tmpdir(), 'c9view-config-'));
  claude = join(root, '.claude');
  project = join(root, 'repo');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('settings', () => {
  it('reads all four sources, ignores missing/malformed files and redacts env', async () => {
    expect(await readSettings(claude, project)).toEqual([]);
    await file(join(claude, 'settings.json'), {
      model: 'user',
      env: { PUBLIC: 'synthetic' },
    });
    await file(join(claude, 'settings.local.json'), { model: 'user-local' });
    await file(join(project, '.claude/settings.json'), { model: 'project' });
    await file(join(project, '.claude/settings.local.json'), {
      model: 'local',
    });
    const layers = await readSettings(claude, project);
    expect(layers.map((x) => x.source.scope)).toEqual([
      'user',
      'user',
      'project',
      'local',
    ]);
    expect(layers[0]?.data.env).toEqual({ PUBLIC: '«redacted:env»' });
    expect(mergeSettings(layers).effective.model).toBe('local');
    await file(join(claude, 'settings.json'), '{broken');
    expect(await readSettings(claude)).toHaveLength(1);
  });
  it('merges precedence, permission arrays, unknown fields and escaped pointers', () => {
    const layers: SettingsLayer[] = [
      {
        source: { scope: 'local', path: 'local' },
        data: {
          model: 'local',
          permissions: { allow: ['B', 'C'], ask: ['Ask'] },
          arr: ['local'],
        },
      },
      {
        source: { scope: 'user', path: 'user' },
        data: {
          model: 'user',
          nested: { a: 1, b: 2 },
          permissions: { allow: ['A', 'B'], deny: ['No'] },
          arr: ['user'],
          'a/b~c': true,
          api_key: 'synthetic',
        },
      },
      {
        source: { scope: 'project', path: 'project' },
        data: { model: 'project', nested: { b: 3 } },
      },
    ];
    const merged = mergeSettings(layers);
    expect(merged.effective).toEqual({
      model: 'local',
      nested: { a: 1, b: 3 },
      permissions: { allow: ['A', 'B', 'C'], deny: ['No'], ask: ['Ask'] },
      arr: ['local'],
      'a/b~c': true,
      api_key: '«redacted:key»',
    });
    expect(merged.provenance).toMatchObject({
      '/model': 'local',
      '/nested/a': 'user',
      '/nested/b': 'project',
      '/a~1b~0c': 'user',
      '/api_key': 'user',
      '/permissions/allow/0': 'user',
      '/permissions/allow/1': 'user',
      '/permissions/allow/2': 'local',
    });
    expect(layers[1]?.data.api_key).toBe('synthetic');
  });
  it('removes stale descendant provenance on replacement', () => {
    const { provenance } = mergeSettings([
      {
        source: { scope: 'user', path: '' },
        data: { nested: { a: 1 }, array: ['a', 'b'] },
      },
      {
        source: { scope: 'project', path: 'settings' },
        data: { nested: false, array: ['c'] },
      },
    ]);
    expect(provenance['/nested/a']).toBeUndefined();
    expect(provenance['/array/1']).toBeUndefined();
    expect(provenance['/array/0']).toBe('project');
  });
});

describe('instruction trees and markdown documents', () => {
  it('resolves relative includes, cycles, aliases and credentials without reading credentials', async () => {
    await file(
      join(project, 'CLAUDE.md'),
      '@includes/one.md\n@alias.md\n@.credentials.json\n@credential-alias.md\npassword=synthetic123456',
    );
    await file(join(project, 'includes/one.md'), '@../CLAUDE.md\n@two.md');
    await file(join(project, 'includes/two.md'), 'ordinary instructions');
    await file(join(project, '.credentials.json'), 'DO NOT READ');
    await symlink(join(project, 'CLAUDE.md'), join(project, 'alias.md'));
    await symlink(
      join(project, '.credentials.json'),
      join(project, 'credential-alias.md'),
    );
    const result = await readInstructions(claude, project);
    expect(result).toHaveLength(1);
    expect(result[0]?.source.scope).toBe('project');
    expect(result[0]?.includes).toHaveLength(3);
    expect(result[0]?.includes[0]?.includes[0]?.content).toBe(
      'ordinary instructions',
    );
    expect(JSON.stringify(result)).not.toContain('DO NOT READ');
    expect(JSON.stringify(result)).not.toContain('synthetic');
  });
  it('limits includes to five levels', async () => {
    await file(join(claude, 'CLAUDE.md'), '@0.md');
    for (let i = 0; i < 8; i++)
      await file(join(claude, `${i}.md`), `@${i + 1}.md`);
    let node = (await readInstructions(claude))[0];
    let count = 0;
    while (node?.includes[0]) {
      count++;
      node = { ...node.includes[0], source: node.source };
    }
    expect(count).toBe(5);
  });
  it('parses YAML, retains unknown fields, follows symlink skills and skips backups', async () => {
    await file(
      join(claude, 'shared/SKILL.md'),
      '---\nname: example\ndescription: |\n  Multi line\n  description\ncustom: [one, two]\n---\nBody',
    );
    await mkdir(join(claude, 'skills'), { recursive: true });
    await symlink(join(claude, 'shared'), join(claude, 'skills/link'));
    const skills = await readSkills(join(claude, 'skills'), 'user');
    expect(skills[0]).toMatchObject({
      name: 'example',
      content: 'Body',
      frontmatter: { custom: ['one', 'two'] },
    });
    await file(
      join(project, 'agents/helper.md'),
      '---\nname: helper\nmodel: example\ntools: [Read, Bash]\n---\nInstructions',
    );
    await file(join(project, 'agents/helper.md.bk'), 'backup');
    await file(join(project, 'agents/old.bk.md'), 'backup');
    expect(await readAgents(join(project, 'agents'), 'project')).toHaveLength(
      1,
    );
    expect(
      (await readCommands(join(project, 'agents'), 'project'))[0]?.tools,
    ).toEqual(['Read', 'Bash']);
    expect(parseFrontmatter('---\ninvalid: [\n---\nbody').frontmatter).toEqual(
      {},
    );
  });
});

describe('MCP, hooks and plugins', () => {
  it('reads all MCP locations and only exposes safe server fields', async () => {
    const server = {
      type: 'stdio',
      command: 'example',
      args: ['synthetic'],
      env: { PUBLIC: 'synthetic' },
      headers: { custom: 'synthetic' },
      unknown: 'synthetic',
    };
    await file(join(root, '.claude.json'), {
      mcpServers: { global: server },
      projects: { [project]: { mcpServers: { personal: server } } },
    });
    await file(join(claude, 'settings.json'), {
      mcpServers: { settings: server },
    });
    await file(join(project, '.mcp.json'), {
      mcpServers: {
        project: {
          transport: 'http',
          url: 'https://user:pass@example.test',
          headers: {},
        },
      },
    });
    const result = await readMcpServers(claude, project);
    expect(result.map((x) => x.name)).toEqual([
      'global',
      'personal',
      'settings',
      'project',
    ]);
    expect(result[0]).toMatchObject({
      args: '«redacted:args»',
      env: '«redacted:env»',
      headers: '«redacted:headers»',
    });
    expect(JSON.stringify(result)).not.toContain('synthetic');
    expect(result[3]?.url).toBe(
      'https://«redacted:url-credentials»@example.test',
    );
  });
  it('flattens hooks and preserves their scope', () => {
    const merged = mergeSettings([
      {
        source: { scope: 'project', path: 'settings' },
        data: {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [
                  { type: 'command', command: 'echo ok', timeout: 20 },
                  { type: 'http', url: 'https://example.test' },
                ],
              },
            ],
            Unknown: null,
          },
        },
      },
    ]);
    expect(readHooks(merged.effective)).toEqual(readHooks(merged));
    expect(readHooks(merged)).toEqual([
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        type: 'command',
        command: 'echo ok',
        timeout: 20,
        source: { scope: 'project', path: 'settings' },
      },
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        type: 'http',
        url: 'https://example.test',
        source: { scope: 'project', path: 'settings' },
      },
    ]);
  });
  it('reads plugin cache install records, enabled flags, marketplaces and components', async () => {
    const install = join(claude, 'plugins/cache/test/example/1');
    await file(join(claude, 'plugins/installed_plugins.json'), {
      version: 2,
      plugins: {
        'example@test': [{ scope: 'user', installPath: install, version: '1' }],
      },
    });
    await file(join(claude, 'plugins/known_marketplaces.json'), {
      test: { source: { source: 'github', repo: 'example/plugins' } },
    });
    await file(join(claude, 'settings.json'), {
      enabledPlugins: { 'example@test': true },
    });
    await file(join(install, 'skills/sample/SKILL.md'), 'skill');
    await file(join(install, 'agents/helper.md'), 'agent');
    await file(join(install, 'commands/run.md'), 'command');
    await file(join(install, 'hooks/hooks.json'), {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }] },
    });
    const result = await readPlugins(claude);
    expect(result.plugins[0]).toMatchObject({
      id: 'example@test',
      enabled: true,
      source: { scope: 'plugin', path: install },
    });
    expect(result.plugins[0]?.skills).toHaveLength(1);
    expect(result.plugins[0]?.agents).toHaveLength(1);
    expect(result.plugins[0]?.commands).toHaveLength(1);
    expect(result.plugins[0]?.hooks[0]?.event).toBe('Stop');
    expect(result.marketplaces[0]?.name).toBe('test');
    expect((await readPlugins(join(root, 'missing'))).plugins).toEqual([]);
  });
});

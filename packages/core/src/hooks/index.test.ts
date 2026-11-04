import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  rename,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendHookEvent,
  HookEventTailer,
  normalizeHookEvent,
  hookStateDir,
} from './events.js';
import {
  updateHookSettings,
  hookCommand,
  hooksInstalled,
  planHookSettings,
  writeHookSettings,
} from './settings.js';
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-hooks-'));
  dirs.push(dir);
  return dir;
}
beforeEach(async () => {
  const home = await temp();
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_STATE_HOME', join(home, 'xdg'));
  vi.stubEnv('C9VIEW_STATE_DIR', undefined);
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const input = {
  hook_event_name: 'PreToolUse',
  session_id: 's',
  cwd: '/tmp/project',
  tool_name: 'Bash',
  prompt: 'secret',
  tool_input: { command: 'secret' },
  tool_response: 'secret',
};
describe('hook files', () => {
  it('stores only allowed metadata with private permissions', async () => {
    const dir = join(await temp(), 'state');
    await appendHookEvent(input, dir);
    const line = await readFile(join(dir, 'events.jsonl'), 'utf8');
    expect(line).not.toContain('secret');
    expect(line.trim().split('\n')).toHaveLength(1);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'events.jsonl'))).mode & 0o777).toBe(0o600);
    expect(
      normalizeHookEvent({
        ...input,
        hook_event_name: 'Notification',
        message: 'permission needed: secret',
      }),
    ).toMatchObject({ notificationType: 'permission_prompt' });
    expect(hookStateDir({ HOME: dir, XDG_STATE_HOME: '/tmp/state' }, [])).toBe(
      join(dir, '.claude/c9view'),
    );
  });
  it('tails partial UTF-8 lines, rotation, malformed lines and bounded sessions', async () => {
    const dir = await temp();
    const path = join(dir, 'events.jsonl');
    const line =
      JSON.stringify(normalizeHookEvent({ ...input, cwd: '/tmp/é' })) + '\n';
    const bytes = Buffer.from(line);
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    await writeFile(path, bytes.subarray(0, split));
    const tail = new HookEventTailer(dir, 1);
    await tail.refresh();
    expect(tail.sessions.size).toBe(0);
    await writeFile(path, bytes.subarray(split), { flag: 'a' });
    await tail.refresh();
    expect(tail.sessions.get('s')).toHaveLength(1);
    await rename(path, join(dir, 'events.1.jsonl'));
    await appendHookEvent(input, dir);
    await tail.refresh();
    expect(tail.sessions.get('s')).toHaveLength(2);
    await writeFile(path, 'bad\n' + 'x'.repeat(70000) + '\n', { flag: 'a' });
    for (let i = 0; i < 205; i++) await appendHookEvent(input, dir);
    await tail.refresh();
    expect(tail.sessions.get('s')).toHaveLength(200);
    await appendHookEvent({ ...input, session_id: 'other' }, dir);
    await tail.refresh();
    expect(tail.sessions.size).toBe(1);
    expect(tail.sessions.has('other')).toBe(true);
  });
  it('rotates at twenty MB and tolerates missing files', async () => {
    const dir = await temp();
    const tail = new HookEventTailer(dir);
    await tail.refresh();
    await writeFile(
      join(dir, 'events.jsonl'),
      Buffer.alloc(20 * 1024 * 1024 + 1),
    );
    await appendHookEvent(input, dir);
    expect((await stat(join(dir, 'events.1.jsonl'))).size).toBe(
      20 * 1024 * 1024 + 1,
    );
  });
});
describe('settings installer', () => {
  const thirdParty = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'rtk hook claude' }],
  };
  const settings = {
    permissions: { allow: ['Read'] },
    hooks: { PreToolUse: [thirdParty] },
  };
  const command = hookCommand('/tmp/node', '/tmp/c9view/main.js');
  it('preserves third-party hooks, is idempotent and reverses only marked entries', () => {
    const installed = updateHookSettings(settings, command, true);
    expect(updateHookSettings(installed, command, true)).toEqual(installed);
    expect(updateHookSettings(installed, command, false)).toEqual(settings);
    expect(settings.hooks.PreToolUse).toEqual([thirdParty]);
    for (const original of [{ hooks: {} }, { hooks: { Stop: [] } }]) {
      expect(
        updateHookSettings(
          updateHookSettings(original, command, true),
          command,
          false,
        ),
      ).toEqual(original);
    }
    expect(
      updateHookSettings(updateHookSettings({}, command, true), command, false),
    ).toEqual({});
  });
  it('previews a unified diff, backs up exact bytes, preserves mode, and rejects concurrent changes', async () => {
    const dir = await temp();
    const path = join(dir, 'settings.json');
    const original = JSON.stringify(settings);
    await writeFile(path, original, { mode: 0o640 });
    const plan = await planHookSettings(dir, command, true);
    expect(plan.diff).toContain('--- settings.json\n+++ settings.json\n@@');
    await writeHookSettings(plan);
    expect(await hooksInstalled(dir)).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    const { readdir } = await import('node:fs/promises');
    const backup = (await readdir(dir)).find((n) => n.includes('backup'))!;
    expect(await readFile(join(dir, backup), 'utf8')).toBe(original);
    expect((await planHookSettings(dir, command, true)).diff).toBe('');
    const uninstall = await planHookSettings(dir, command, false);
    await writeHookSettings(uninstall);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(settings);
    const race = await planHookSettings(dir, command, true);
    await writeFile(path, '{}');
    await expect(writeHookSettings(race)).rejects.toThrow('changed');
  });
});

it('caps stdin by size and time, including split UTF-8 input', async () => {
  const { PassThrough } = await import('node:stream');
  const { readHookInput } = await import('./events.js');
  const { vi } = await import('vitest');
  const input = new PassThrough();
  const text = readHookInput(input as unknown as NodeJS.ReadStream);
  input.end(Buffer.from('{"text":"é"}'));
  expect(await text).toBe('{"text":"é"}');
  const oversized = new PassThrough();
  const bounded = readHookInput(oversized as unknown as NodeJS.ReadStream);
  oversized.write(Buffer.alloc(65537));
  expect(await bounded).toBeNull();
  vi.useFakeTimers();
  try {
    const hanging = new PassThrough();
    const timeout = readHookInput(hanging as unknown as NodeJS.ReadStream);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await timeout).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('rejects symlinked files/directories and foreign ownership, and tightens existing directories', async () => {
  const { symlink, mkdir, chmod, lstat } = await import('node:fs/promises');
  const { vi } = await import('vitest');
  const dir = await temp();
  const target = join(dir, 'target');
  await writeFile(target, 'untouched');
  const state = join(dir, 'state');
  await mkdir(state);
  await symlink(target, join(state, 'events.jsonl'));
  await appendHookEvent(input, state);
  expect(await readFile(target, 'utf8')).toBe('untouched');
  await symlink(state, join(dir, 'linked-state'));
  await rm(join(state, 'events.jsonl'));
  await appendHookEvent(input, join(dir, 'linked-state'));
  await expect(lstat(join(state, 'events.jsonl'))).rejects.toThrow();
  if (process.getuid) {
    const uid = vi
      .spyOn(process, 'getuid')
      .mockReturnValue((await lstat(state)).uid + 1);
    try {
      await appendHookEvent(input, state);
    } finally {
      uid.mockRestore();
    }
    await expect(lstat(join(state, 'events.jsonl'))).rejects.toThrow();
  }
  await chmod(state, 0o755);
  await appendHookEvent(input, state);
  expect((await stat(state)).mode & 0o777).toBe(0o700);
});

it('never rotates over a symlink', async () => {
  const { symlink } = await import('node:fs/promises');
  const dir = await temp();
  const target = join(dir, 'target');
  await writeFile(target, 'untouched');
  await writeFile(
    join(dir, 'events.jsonl'),
    Buffer.alloc(20 * 1024 * 1024 + 1),
  );
  await symlink(target, join(dir, 'events.1.jsonl'));
  await appendHookEvent(input, dir);
  expect(await readFile(target, 'utf8')).toBe('untouched');
  expect((await stat(join(dir, 'events.jsonl'))).size).toBe(
    20 * 1024 * 1024 + 1,
  );
});

it('keeps agent identifiers as metadata and scopes only documented lifecycle events', () => {
  expect(
    normalizeHookEvent({ ...input, agent_id: 'main-agent' }),
  ).toMatchObject({ agentId: 'main-agent' });
  expect(
    normalizeHookEvent({ ...input, agent_id: 'main-agent' }),
  ).not.toHaveProperty('subagent');
  for (const event of ['SubagentStart', 'SubagentStop'])
    expect(
      normalizeHookEvent({
        ...input,
        hook_event_name: event,
        agent_id: 'child',
      }),
    ).toMatchObject({ subagent: true });
});

it('upgrades old CLI hook commands to async standalone entries', () => {
  const old = updateHookSettings(
    {},
    "'/tmp/node' '/tmp/main.js' hook --c9view-hook",
    true,
  );
  const command = hookCommand(
    '/tmp/node',
    '/tmp/core/dist/hooks/hook-entry.js',
  );
  const updated = updateHookSettings(old, command, true);
  const text = JSON.stringify(updated);
  expect(text).not.toContain('/tmp/main.js');
  expect(command).toBe(
    "'/tmp/node' '/tmp/core/dist/hooks/hook-entry.js' --c9view-hook",
  );
  const hooks = updated.hooks as Record<
    string,
    { hooks: Record<string, unknown>[] }[]
  >;
  for (const event of [
    'SubagentStart',
    'PostToolBatch',
    'PermissionDenied',
    'StopFailure',
  ])
    expect(hooks[event]![0]!.hooks[0]).toMatchObject({
      async: true,
      timeout: 5,
    });
  expect(updateHookSettings(updated, command, true)).toEqual(updated);
  expect(updateHookSettings(updated, command, false)).toEqual({});
});

it('shows additions with context while retaining existing hooks in the diff', async () => {
  const { lineDiff } = await import('./settings.js');
  const existing = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'existing-hook' }],
        },
      ],
    },
  };
  const before = JSON.stringify(existing, null, 2) + '\n';
  const after =
    JSON.stringify(
      updateHookSettings(
        existing,
        hookCommand('/tmp/node', '/tmp/entry.js'),
        true,
      ),
      null,
      2,
    ) + '\n';
  const diff = lineDiff(before, after);
  expect(diff).toContain('@@');
  expect(diff.split('\n').filter((line) => line.startsWith('-'))).toEqual([
    '--- settings.json',
  ]);
  expect(diff).not.toContain('+            "command": "existing-hook"');
  expect(
    lineDiff(
      'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n',
      'a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\nk\n',
    ).match(/@@ -/g),
  ).toHaveLength(2);
});

it('keeps the standalone entry import graph within hooks and node built-ins', async () => {
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('.', import.meta.url));
  const visited = new Set<string>();
  async function scan(path: string): Promise<void> {
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g,
    )) {
      const name = match[1]!;
      if (name.startsWith('node:')) continue;
      expect(name.startsWith('./')).toBe(true);
      const target = resolve(dirname(path), name.replace(/\.js$/, '.ts'));
      expect(target.startsWith(root)).toBe(true);
      await scan(target);
    }
  }
  await scan(join(root, 'hook-entry.ts'));
  expect(visited.size).toBe(3);
});

it.each(['default', 'argument', 'override', 'empty'])(
  'fires the standalone hook silently with %s state resolution',
  async (mode) => {
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const home = await temp();
    const argument = join(home, "state folder's");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      XDG_STATE_HOME: join(home, 'xdg'),
    };
    delete env.C9VIEW_STATE_DIR;
    if (mode === 'override')
      Object.assign(env, { C9VIEW_STATE_DIR: join(home, 'wrong') });
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../dist/hooks/hook-entry.js', import.meta.url),
        ),
        '--c9view-hook',
        ...(mode === 'default'
          ? []
          : mode === 'empty'
            ? ['--c9view-state-dir']
            : ['--c9view-state-dir', argument]),
      ],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const finished = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
    child.stdin.end(JSON.stringify(input));
    expect(await finished).toBe(0);
    expect(output).toBe('');
    if (mode === 'empty') {
      const { readdir } = await import('node:fs/promises');
      expect(await readdir(home)).toEqual([]);
      return;
    }
    const dir = mode === 'default' ? join(home, '.claude/c9view') : argument;
    expect(await readFile(join(dir, 'events.jsonl'), 'utf8')).not.toContain(
      'secret',
    );
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'events.jsonl'))).mode & 0o777).toBe(0o600);
  },
);

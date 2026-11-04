import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
});
it('executes scan --json through the CLI entry point', async () => {
  process.argv = [
    'node',
    'c9view',
    'scan',
    '--json',
    '--db',
    ':memory:',
    '--claude-dir',
    fileURLToPath(new URL('../../../tests/fixtures/claude', import.meta.url)),
  ];
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('./main.js');
  expect(JSON.parse(output.mock.calls[0]![0] as string)).toMatchObject({
    projects: 2,
    sessions: 3,
    subagentSessions: 1,
  });
});
it('rejects unsupported arguments', async () => {
  process.argv = ['node', 'c9view', 'scan', '--unsupported'];
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./main.js');
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalled();
});

it('reports a missing Claude directory on stderr, exits 1 and creates no DB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'c9view-cli-'));
  try {
    const db = path.join(dir, 'index.sqlite');
    process.argv = [
      'node',
      'c9view',
      'scan',
      '--claude-dir',
      path.join(dir, 'missing'),
      '--db',
      db,
    ];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('./main.js');
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Claude directory'),
    );
    expect(output).not.toHaveBeenCalled();
    await expect(access(db)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([
  [],
  ['start'],
  ['scan'],
  ['hooks', 'install'],
  ['hooks', 'uninstall'],
  ['hooks', 'status'],
  ['hook'],
])('shows help without running %j', async (...command) => {
  process.argv = ['node', 'c9view', ...command, '--help'];
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('./main.js');
  expect(output).toHaveBeenCalledWith(
    expect.stringContaining('c9view hooks install|uninstall'),
  );
});
it('accepts the short help flag', async () => {
  process.argv = ['node', 'c9view', '-h'];
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('./main.js');
  expect(output).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
});

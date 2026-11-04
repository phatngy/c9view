import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { hubPackageUrl, runStart } from './start.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});
it('rejects invalid auth and port flags before loading the server', async () => {
  await expect(runStart({ auth: 'basic' })).rejects.toThrow('--auth');
  for (const port of ['1e3', 'NaN', '1.5', ''])
    await expect(runStart({ port })).rejects.toThrow('--port');
});
it('starts the hub package', async () => {
  const pkg = JSON.parse(await readFile(new URL(hubPackageUrl()), 'utf8')) as {
    name: string;
  };
  expect(pkg.name).toBe('@c9view/hub');
});
it('defaults the CLI to start and forwards repeatable hosts and options', async () => {
  const argv = process.argv;
  const run = vi.fn();
  vi.doMock('./start.js', () => ({ runStart: run }));
  try {
    process.argv = ['node', 'c9view'];
    await import('./main.js');
    expect(run).toHaveBeenCalledWith({});
    vi.resetModules();
    process.argv = [
      'node',
      'c9view',
      'start',
      '--port',
      '8888',
      '--host',
      'localhost',
      '--allowed-host',
      'one.example',
      '--allowed-host',
      'two.example',
      '--auth',
      'token',
      '--open',
    ];
    await import('./main.js');
    expect(run).toHaveBeenLastCalledWith({
      port: '8888',
      host: 'localhost',
      'allowed-host': ['one.example', 'two.example'],
      auth: 'token',
      open: true,
    });
  } finally {
    process.argv = argv;
    vi.doUnmock('./start.js');
  }
});

it('requires control with bypass and names both ways to enable it', async () => {
  vi.stubEnv('C9VIEW_CONTROL', '0');
  try {
    await expect(runStart({ bypass: true })).rejects.toThrow(
      'Add --control or set C9VIEW_CONTROL=1',
    );
    vi.stubEnv('C9VIEW_CONTROL_BYPASS', '1');
    await expect(runStart({})).rejects.toThrow('--bypass requires control');
  } finally {
    vi.unstubAllEnvs();
  }
});

it('parses control and bypass flags', async () => {
  const argv = process.argv;
  const run = vi.fn();
  vi.doMock('./start.js', () => ({ runStart: run }));
  try {
    process.argv = [
      'node',
      'c9view',
      'start',
      '--control',
      '--bypass',
      '--auth',
      'token',
    ];
    await import('./main.js');
    expect(run).toHaveBeenCalledWith({
      control: true,
      bypass: true,
      auth: 'token',
    });
  } finally {
    process.argv = argv;
    vi.doUnmock('./start.js');
  }
});

it('forwards control options to startServer without overriding absent environment options', async () => {
  const { fileURLToPath } = await import('node:url');
  const entry = fileURLToPath(new URL('./dist/main.js', hubPackageUrl()));
  const startServer = vi.fn();
  vi.doMock(entry, () => ({ startServer }));
  try {
    await runStart({ control: true, bypass: true, auth: 'token' });
    expect(startServer).toHaveBeenLastCalledWith(
      expect.objectContaining({ control: true, bypass: true, auth: 'token' }),
    );
    await runStart({});
    const forwarded = startServer.mock.calls[1]![0];
    expect(forwarded).not.toHaveProperty('control');
    expect(forwarded).not.toHaveProperty('bypass');
  } finally {
    vi.doUnmock(entry);
  }
});

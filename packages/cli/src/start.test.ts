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

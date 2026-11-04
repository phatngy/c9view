import { afterEach, expect, it, vi } from 'vitest';
import { printLogin, startServer } from '../main.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('keeps tokens out of redirected/container logs', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  printLogin('http://localhost:7777', 'synthetic-secret', false);
  expect(log.mock.calls.flat().join('\n')).not.toContain('synthetic-secret');
  expect(log).toHaveBeenCalledWith('Login: http://localhost:7777/login');
  expect(log).toHaveBeenCalledWith(expect.stringContaining('C9VIEW_TOKEN'));
});
it('prints a separate token in interactive terminals', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  printLogin('http://localhost:7777', 'synthetic-secret', true);
  expect(log).toHaveBeenCalledWith('Token: synthetic-secret');
  expect(log.mock.calls.flat().join('\n')).not.toContain('?token=');
});
it('rejects invalid environment auth and short tokens before startup', () => {
  vi.stubEnv('C9VIEW_AUTH', 'invalid');
  expect(() => startServer()).toThrow(
    'C9VIEW_AUTH must be one of: none, token, password',
  );
  vi.stubEnv('C9VIEW_AUTH', 'token');
  vi.stubEnv('C9VIEW_TOKEN', 'a');
  expect(() => startServer()).toThrow(
    'C9VIEW_TOKEN must contain at least 32 characters',
  );
});
it('rejects invalid transport limits before the index starts', async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'c9view-limits-'));
  try {
    await mkdir(join(dir, 'claude'));
    await writeFile(join(dir, 'index.html'), '<html></html>');
    vi.stubEnv('C9VIEW_REQUEST_DEADLINE_MS', 'soon');
    expect(() =>
      startServer({
        auth: 'none',
        claudeDir: join(dir, 'claude'),
        db: join(dir, 'index.sqlite'),
        webDist: dir,
      }),
    ).toThrow('C9VIEW_REQUEST_DEADLINE_MS');
    expect(existsSync(join(dir, 'index.sqlite'))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

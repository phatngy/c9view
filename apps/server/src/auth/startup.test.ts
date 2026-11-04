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

import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { statusHistory } from './session/api.js';

afterEach(() => vi.unstubAllGlobals());
it('scopes every node request and encodes machine identities', async () => {
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const machine = 'remote/a b';
  await Promise.all([
    api.overview(machine),
    api.projects(machine),
    api.project(machine, 'p'),
    api.config(machine),
    api.health(machine),
    api.files(machine, 'p', ''),
    api.file(machine, 'p', 'a.ts'),
    api.gitStatus(machine, 'p'),
    api.gitDiff(machine, 'p', 'a.ts'),
    api.changes(machine, 'p', 's'),
    api.change(machine, 'p', 's', 'f'),
    api.session(machine, 'p', 's'),
    api.sessionPoll(machine, 'p', 's'),
    statusHistory(machine, 'p', 's'),
    api.search(
      machine,
      { q: 'test', projectId: '', from: '', to: '', model: '' },
      null,
    ),
    api.usage(machine, { from: '', to: '', tz: 'UTC', projectId: '' }),
  ]);
  expect(fetch).toHaveBeenCalledTimes(16);
  for (const [url] of fetch.mock.calls as unknown as [string][]) {
    expect(url).toMatch(/^\/api\/m\/remote%2Fa%20b\//);
  }
});
it('keeps hub health and machines unscoped', async () => {
  const fetch = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  await api.hubHealth();
  await api.machines();
  expect(fetch).toHaveBeenNthCalledWith(1, '/api/health', undefined);
  expect(fetch).toHaveBeenNthCalledWith(2, '/api/machines', undefined);
});

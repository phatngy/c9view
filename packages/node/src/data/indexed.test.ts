import {
  cp,
  mkdtemp,
  rm,
  appendFile,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import type { SessionDetailResponse, SearchResponse } from '@c9view/api';
import { DataStore } from './store.js';
import { startIndex } from './start-index.js';
import { createApp } from '../test-app.js';

let dir: string;
let store: DataStore;
let runtime: ReturnType<typeof startIndex> | undefined;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-index-server-'));
  vi.stubEnv('C9VIEW_STATE_DIR', join(dir, 'state'));
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', join(dir, 'legacy'));
  const claudeDir = join(dir, 'claude');
  await cp(
    fileURLToPath(new URL('../../test/fixtures/claude', import.meta.url)),
    claudeDir,
    { recursive: true },
  );
  store = new DataStore(
    loadConfig({
      C9VIEW_CLAUDE_DIR: claudeDir,
      C9VIEW_DB: join(dir, 'index.sqlite'),
    }),
  );
  app = createApp(store.config, { store });
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  store.hooks.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function json(path: string) {
  const r = await app.request(path);
  expect(r.status).toBe(200);
  return r.json();
}
it('keeps the fixture file and SQLite HTTP contracts identical, including every message page', async () => {
  const childDir = join(
    store.config.claudeDir,
    'projects/-fixture-alpha/s2/subagents',
  );
  await mkdir(childDir, { recursive: true });
  await writeFile(
    join(childDir, 'agent-extra.jsonl'),
    JSON.stringify({
      type: 'assistant',
      uuid: 'extra',
      message: {
        id: 'extra',
        model: 'claude-haiku-4-5',
        content: [],
        usage: { input_tokens: 17, output_tokens: 9 },
      },
    }) + '\n',
  );
  // A fork retains copied history per file on both paths. Repeated message
  // snapshots within a file use the latest usage, regardless of request ID.
  const forkRecords = [1, 2, 3].map((n) => ({
    type: 'assistant',
    uuid: `fork-${n}`,
    requestId: `req-${n}`,
    message: {
      id: 'shared',
      model: 'claude-sonnet-4-6',
      content: [],
      ...(n === 3
        ? {}
        : {
            usage: {
              input_tokens: n * 10,
              cache_creation_input_tokens: 100,
              cache_creation: { ephemeral_1h_input_tokens: 30 },
            },
          }),
    },
  }));
  for (const name of ['fork-a', 'fork-b'])
    await writeFile(
      join(store.config.claudeDir, `projects/-fixture-alpha/${name}.jsonl`),
      forkRecords.map((r) => JSON.stringify(r) + '\n').join(''),
    );
  const paths = [
    '/api/overview',
    '/api/projects',
    '/api/projects/-fixture-alpha',
    '/api/projects/-fixture-beta',
    ...['s1', 's2'].flatMap((s) =>
      [
        '',
        '?limit=1',
        '?cursor=1&limit=2',
        '?cursor=999',
        '?from=end&limit=2',
        '?from=end&limit=0',
        '?from=end',
        '?from=end&cursor=1&limit=2',
        '?from=bogus&limit=2',
      ].map((q) => `/api/projects/-fixture-alpha/sessions/${s}${q}`),
    ),
    '/api/projects/-fixture-beta/sessions/s3',
    '/api/projects/-fixture-alpha/sessions/fork-a',
    '/api/projects/-fixture-alpha/sessions/fork-b',
  ];
  const before = await Promise.all(paths.map(json));
  runtime = startIndex(store.config, store);
  await runtime.ready;
  expect(store.indexHealth.state).toBe('ready');
  const reads = vi.spyOn(store.cache, 'get');
  const mapped = vi.spyOn(store.cache, 'mapped');
  for (const [i, path] of paths.entries()) {
    const after = await json(path);
    const equivalent = (a: unknown, b: unknown): void => {
      if (typeof a === 'number' && typeof b === 'number') {
        expect(Math.abs(a - b), path).toBeLessThanOrEqual(1e-9);
      } else if (Array.isArray(a) && Array.isArray(b)) {
        expect(a.length, path).toBe(b.length);
        a.forEach((value, i) => equivalent(value, b[i]));
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        expect(Object.keys(a).sort(), path).toEqual(Object.keys(b).sort());
        for (const [key, value] of Object.entries(a))
          equivalent(value, (b as Record<string, unknown>)[key]);
      } else expect(a, path).toEqual(b);
    };
    equivalent(after, before[i]);
  }
  expect(reads).not.toHaveBeenCalled();
  expect(mapped).not.toHaveBeenCalled();
});
it('searches redacted text with filters, bounded snippets and complete cursor pagination', async () => {
  const file = join(
    store.config.claudeDir,
    'projects/-fixture-alpha/search.jsonl',
  );
  await writeFile(
    file,
    Array.from(
      { length: 1005 },
      (_, i) =>
        JSON.stringify({
          type: 'user',
          uuid: `search-${String(i).padStart(4, '0')}`,
          timestamp: '2026-10-25T00:00:00.000Z',
          message: {
            content: `needle sk-ant-fixture-super-secret-value-123456789 ${'x'.repeat(300)}`,
          },
        }) + '\n',
    ).join(''),
  );
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const seen = new Set<string>();
  let cursor: string | null = '0';
  while (cursor !== null) {
    const response = (await json(
      `/api/search?q=needle&projectId=-fixture-alpha&from=2026-10-25&to=2026-10-25&limit=200&cursor=${cursor}`,
    )) as SearchResponse;
    for (const r of response.results) {
      expect(r.snippet.length).toBeLessThanOrEqual(240);
      expect(r.snippet).not.toContain('sk-ant-');
      expect(r.highlights).toEqual([[0, 6]]);
      expect(seen.has(r.messageUuid)).toBe(false);
      seen.add(r.messageUuid);
    }
    cursor = response.nextCursor;
  }
  expect(seen.size).toBe(1005);
  expect((await json('/api/search?q=needle&model=missing')).results).toEqual(
    [],
  );
  expect((await json('/api/search?q=needle&to=2026-10-24')).results).toEqual(
    [],
  );
  expect(
    (await json('/api/search?q=needle&projectId=missing')).results,
  ).toEqual([]);
});
it('preserves inline Edit changes when the result falls outside a message page', async () => {
  const file = join(
    store.config.claudeDir,
    'projects/-fixture-alpha/edit.jsonl',
  );
  await writeFile(
    file,
    [
      {
        type: 'assistant',
        uuid: 'edit-use',
        message: {
          id: 'edit-use',
          model: 'unknown',
          content: [
            {
              type: 'tool_use',
              id: 'edit',
              name: 'Edit',
              input: {
                file_path: '/fixture/file.ts',
                old_string: 'old',
                new_string: 'new',
              },
            },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'edit-result',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'edit', content: 'ok' },
          ],
        },
        toolUseResult: {
          filePath: '/fixture/file.ts',
          type: 'update',
          originalFile: 'old',
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: ['-old', '+new'],
            },
          ],
        },
      },
    ]
      .map((r) => JSON.stringify(r) + '\n')
      .join(''),
  );
  const path = '/api/projects/-fixture-alpha/sessions/edit?limit=1';
  const before = (await json(path)) as SessionDetailResponse;
  expect(before.messages[0]?.blocks[0]).toHaveProperty('change');
  runtime = startIndex(store.config, store);
  await runtime.ready;
  expect(await json(path)).toEqual(before);
});
it('keeps fallback available after an index startup failure', async () => {
  await mkdir(join(dir, 'blocked'));
  runtime = startIndex(
    { ...store.config, dbPath: join(dir, 'blocked') },
    store,
  );
  await runtime.ready;
  expect(store.indexHealth.state).toBe('error');
  expect((await json('/api/projects')).projects).toHaveLength(2);
});
it('emits computed status transitions from live-file and hook-tail updates', async () => {
  const { HookEvents } = await import('./hook-events.js');
  store.hooks.close();
  const state = join(dir, 'hooks');
  await mkdir(state, { mode: 0o700 });
  store = new DataStore(store.config, { hooks: new HookEvents(state) });
  app = createApp(store.config, { store });
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const events: import('./events.js').NodeLiveEvent[] = [];
  const unsubscribe = store.events.subscribe((e) => events.push(e));
  await mkdir(join(store.config.claudeDir, 'sessions'), { recursive: true });
  await writeFile(
    join(store.config.claudeDir, 'sessions/live.json'),
    JSON.stringify({
      pid: process.pid,
      sessionId: 's2',
      status: 'busy',
      statusUpdatedAt: new Date().toISOString(),
    }),
  );
  await vi.waitFor(
    () =>
      expect(events).toContainEqual({
        event: 'status',
        data: {
          projectId: '-fixture-alpha',
          sessionId: 's2',
          column: 'in_progress',
        },
      }),
    { timeout: 5000 },
  );
  events.length = 0;
  await appendFile(
    join(state, 'events.jsonl'),
    JSON.stringify({
      v: 1,
      ts: new Date().toISOString(),
      event: 'PermissionRequest',
      sessionId: 's2',
      cwd: '/fixture',
    }) + '\n',
  );
  await vi.waitFor(
    () =>
      expect(events).toContainEqual({
        event: 'status',
        data: {
          projectId: '-fixture-alpha',
          sessionId: 's2',
          column: 'need_input',
        },
      }),
    { timeout: 5000 },
  );
  events.length = 0;
  await writeFile(join(store.config.claudeDir, 'settings.local.json'), '{}');
  await vi.waitFor(
    () => expect(events).toContainEqual({ event: 'config', data: {} }),
    { timeout: 5000 },
  );
  expect(events.filter((e) => e.event === 'status')).toHaveLength(0);
  unsubscribe();
});
it('reports the scan timestamp stored by the indexer', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const row = store
    .index!.sqlite.prepare("SELECT value FROM meta WHERE key='lastFullScanAt'")
    .get() as { value: string };
  expect(store.indexHealth.lastFullScanAt).toBe(JSON.parse(row.value));
});

it('retains the previous successful scan timestamp while rebuilding', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const previous = store.indexHealth.lastFullScanAt;
  await runtime.close();
  store = new DataStore(store.config);
  app = createApp(store.config, { store });
  runtime = startIndex(store.config, store);
  expect(store.indexHealth).toEqual({
    state: 'building',
    lastFullScanAt: previous,
  });
  await runtime.ready;
  expect(store.indexHealth.state).toBe('ready');
});

it('rolls children into cards and makes project headers exactly equal their cards', async () => {
  for (const indexed of [false, true]) {
    if (indexed) {
      runtime = startIndex(store.config, store);
      await runtime.ready;
    }
    const overview = await json('/api/overview');
    const projects = await Promise.all(
      ['-fixture-alpha', '-fixture-beta'].map((id) =>
        json('/api/projects/' + id),
      ),
    );
    for (const { project, sessions } of projects) {
      expect(project.costUsd).toBe(
        sessions.reduce(
          (n: number, s: { costUsd: number }) => n + s.costUsd,
          0,
        ),
      );
      const { sumTokens } = await import('./store.js');
      expect(project.tokens).toEqual(
        sumTokens(
          sessions.map((s: import('@c9view/api').SessionSummary) => s.tokens),
        ),
      );
    }
    expect(overview.costUsd).toBe(
      projects.reduce((n, p) => n + p.project.costUsd, 0),
    );
    const { session, byModel } = await json(
      '/api/projects/-fixture-alpha/sessions/s1',
    );
    expect(session.subagentCount).toBe(1);
    expect(session.subagentCostUsd).toBeGreaterThan(0);
    expect(session.costUsd).toBe(session.ownCostUsd + session.subagentCostUsd);
    expect(
      byModel.reduce((n: number, m: { costUsd: number }) => n + m.costUsd, 0),
    ).toBeCloseTo(session.costUsd, 9);
  }
});
it('reuses unaffected project entries on targeted invalidation', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const before = await store.snapshot();
  store.invalidate('-fixture-alpha');
  const after = await store.snapshot();
  expect(after.find((p) => p.project.id === '-fixture-beta')).toBe(
    before.find((p) => p.project.id === '-fixture-beta'),
  );
  expect(after.find((p) => p.project.id === '-fixture-alpha')).not.toBe(
    before.find((p) => p.project.id === '-fixture-alpha'),
  );
});
it('closes the watcher and DB, including repeated close calls', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const db = store.index!;
  await Promise.all([runtime.close(), runtime.close()]);
  expect(db.sqlite.open).toBe(false);
  expect(store.index).toBeUndefined();
});

it('supports literal unicode tokens and prefix search over HTTP', async () => {
  await writeFile(
    join(store.config.claudeDir, 'projects/-fixture-alpha/prefix.jsonl'),
    JSON.stringify({
      type: 'user',
      uuid: 'prefix',
      message: { content: 'alphabet Café 東京 «redacted:api-key»' },
    }) + '\n',
  );
  runtime = startIndex(store.config, store);
  await runtime.ready;
  for (const q of ['a*', '*alphabet', 'cafe,東京']) {
    const result = await json('/api/search?q=' + encodeURIComponent(q));
    const row = result.results.find(
      (r: { messageUuid: string }) => r.messageUuid === 'prefix',
    );
    expect(row).toBeDefined();
    expect(row.highlights.length).toBeGreaterThan(0);
    expect(
      row.highlights.every(
        ([a, b]: [number, number]) =>
          !row.snippet.slice(a, b).includes('redacted'),
      ),
    ).toBe(true);
  }
});
it('builds expired snapshots from list rows without per-session selects or directory reads', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const prepare = vi.spyOn(store.index!.sqlite, 'prepare');
  const read = vi.spyOn(store.cache, 'get');
  store.invalidate();
  await store.snapshot();
  const sql = prepare.mock.calls.map(([sql]) => sql);
  expect(sql.filter((s) => /FROM "projects"/i.test(s))).toHaveLength(1);
  expect(
    sql.some((s) => /FROM "sessions" WHERE "sessions"\."id"/i.test(s)),
  ).toBe(false);
  expect(sql.filter((s) => /GROUP BY parentSessionId/.test(s))).toHaveLength(1);
  expect(read).not.toHaveBeenCalled();
});

it('refreshes the parent roll-up when a pre-existing subagent is removed', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const path = '/api/projects/-fixture-alpha';
  const before = await json(path);
  expect(
    before.sessions.find((s: { id: string }) => s.id === 's1').subagentCount,
  ).toBe(1);
  await rm(
    join(
      store.config.claudeDir,
      'projects/-fixture-alpha/s1/subagents/agent-child.jsonl',
    ),
  );
  await vi.waitFor(
    async () => {
      const after = await json(path);
      const parent = after.sessions.find((s: { id: string }) => s.id === 's1');
      expect(parent.subagentCount).toBe(0);
      expect(parent.subagentCostUsd).toBe(0);
      expect(after.project.costUsd).toBeLessThan(before.project.costUsd);
    },
    { timeout: 4000 },
  );
});

it('invalidates tail pages after growth while preserving absolute history cursors', async () => {
  const file = join(
    store.config.claudeDir,
    'projects/-fixture-alpha/growth.jsonl',
  );
  const records = (start: number, count: number) =>
    Array.from(
      { length: count },
      (_, i) =>
        JSON.stringify({
          type: 'user',
          uuid: `growth-${start + i}`,
          message: { content: 'growth' },
        }) + '\n',
    ).join('');
  await writeFile(file, records(0, 10));
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const path = '/api/projects/-fixture-alpha/sessions/growth';
  const initial = (await json(
    path + '?from=end&limit=2',
  )) as SessionDetailResponse;
  expect(initial).toMatchObject({
    cursor: 8,
    prevCursor: 6,
    nextCursor: null,
    totalMessages: 10,
  });
  const head = (await json(
    path + '?cursor=0&limit=2',
  )) as SessionDetailResponse;
  expect(head.messages.map((m) => m.uuid)).toEqual(['growth-0', 'growth-1']);
  expect(await json(path + '?from=end&limit=2')).toEqual(initial);
  await appendFile(file, records(10, 2));
  await vi.waitFor(
    async () => {
      const latest = (await json(
        path + '?from=end&limit=2',
      )) as SessionDetailResponse;
      expect(latest).toMatchObject({
        cursor: 10,
        prevCursor: 8,
        nextCursor: null,
        totalMessages: 12,
      });
      expect(latest.messages.map((m) => m.uuid)).toEqual([
        'growth-10',
        'growth-11',
      ]);
    },
    { timeout: 4000 },
  );
  const history = (await json(
    path + `?cursor=${initial.prevCursor}&limit=2`,
  )) as SessionDetailResponse;
  expect(history.messages.map((m) => m.uuid)).toEqual(['growth-6', 'growth-7']);
  expect(history).toMatchObject({ cursor: 6, prevCursor: 4, nextCursor: 8 });
});
it('keeps file and indexed pagination identical at the default and maximum limits', async () => {
  await writeFile(
    join(store.config.claudeDir, 'projects/-fixture-alpha/large.jsonl'),
    Array.from(
      { length: 1002 },
      (_, i) =>
        JSON.stringify({
          type: 'user',
          uuid: `large-${i}`,
          message: { content: 'large' },
        }) + '\n',
    ).join(''),
  );
  const path = '/api/projects/-fixture-alpha/sessions/large';
  const queries = [
    '',
    '?from=end',
    '?limit=9999',
    '?from=end&limit=9999',
    '?cursor=99999&limit=2',
  ];
  const before = await Promise.all(queries.map((q) => json(path + q)));
  expect(before[0].messages).toHaveLength(200);
  expect(before[1]).toMatchObject({
    cursor: 802,
    prevCursor: 602,
    nextCursor: null,
  });
  expect(before[2].messages).toHaveLength(1000);
  expect(before[3]).toMatchObject({
    cursor: 2,
    prevCursor: 0,
    nextCursor: null,
  });
  runtime = startIndex(store.config, store);
  await runtime.ready;
  for (const [i, query] of queries.entries())
    expect(await json(path + query)).toEqual(before[i]);
});

import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadConfig } from '@c9view/core';
import type {
  OverviewResponse,
  ProjectDetailResponse,
  UsageResponse,
} from '@c9view/api';
import { DataStore } from '../data/store.js';
import { startIndex } from '../data/start-index.js';
import { createApp } from '../app.js';
let dir: string;
let store: DataStore;
let runtime: ReturnType<typeof startIndex> | undefined;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-usage-'));
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
  await rm(dir, { recursive: true, force: true });
});
async function ready() {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  expect(store.readyIndex).toBeDefined();
}
async function usage(query: string) {
  const r = await app.request('/api/usage?' + query);
  expect(r.status).toBe(200);
  return (await r.json()) as UsageResponse;
}
it('requires the ready index and validates calendar dates, timezone, and inclusive range', async () => {
  const r = await app.request('/api/usage');
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({
    error: 'Charts are available once indexing finishes',
  });
  for (const q of [
    'tz=Invalid/Zone',
    'from=2026-02-30',
    'from=nope',
    'from=2026-10-26&to=2026-10-25',
    'from=2025-01-01&to=2026-01-02',
  ])
    expect((await app.request('/api/usage?' + q)).status, q).toBe(400);
  await ready();
  expect((await usage('')).days).toHaveLength(30);
  expect((await usage('from=2025-10-25&to=2026-10-25')).days).toHaveLength(366);
});
it('zero-fills every day and uses null cache ratios for empty denominators', async () => {
  await ready();
  const result = await usage('from=2026-10-23&to=2026-10-25');
  expect(result.days.map((d) => d.date)).toEqual([
    '2026-10-23',
    '2026-10-24',
    '2026-10-25',
  ]);
  expect(result.days[0]).toMatchObject({
    costUsd: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      thinking: 0,
    },
    byModel: [],
  });
  expect(result.cacheHit[0]?.ratio).toBeNull();
  const t = result.days[2]!.tokens;
  expect(result.cacheHit[2]!.ratio).toBe(
    t.cacheRead / (t.cacheRead + t.input + t.cacheCreation),
  );
});
it('buckets message timestamps across midnight in the requested IANA timezone', async () => {
  await writeFile(
    join(store.config.claudeDir, 'projects/-fixture-alpha/midnight.jsonl'),
    JSON.stringify({
      type: 'assistant',
      uuid: 'midnight',
      timestamp: '2026-10-24T23:30:00Z',
      message: {
        id: 'midnight',
        model: 'claude-sonnet-4-6',
        content: [],
        usage: { input_tokens: 777 },
      },
    }) + '\n',
  );
  await ready();
  const utc = await usage('from=2026-10-24&to=2026-10-25');
  const local = await usage(
    'from=2026-10-24&to=2026-10-25&tz=Asia/Ho_Chi_Minh',
  );
  expect(utc.days[0]!.tokens.input).toBe(777);
  expect(local.days[0]!.tokens.input).toBe(0);
  expect(local.days[1]!.tokens.input - utc.days[1]!.tokens.input).toBe(777);
  expect(local.totals).toEqual(utc.totals);
});
it('exactly matches overview and project card totals, including subagents, per-file dedupe and copied history', async () => {
  const records = [1, 2, 3].map((n) => ({
    type: 'assistant',
    uuid: `copy-${n}`,
    timestamp: '2026-10-25T01:00:00Z',
    message: {
      id: 'shared',
      model: 'claude-sonnet-4-6',
      content: [],
      ...(n === 3
        ? {}
        : {
            usage: {
              input_tokens: n * 10,
              output_tokens: 13,
              cache_creation_input_tokens: 100,
              cache_creation: { ephemeral_1h_input_tokens: 30 },
            },
          }),
    },
  }));
  for (const name of ['copy-a', 'copy-b'])
    await writeFile(
      join(store.config.claudeDir, `projects/-fixture-alpha/${name}.jsonl`),
      records.map((r) => JSON.stringify(r) + '\n').join(''),
    );
  await ready();
  const overview = (await (
    await app.request('/api/overview')
  ).json()) as OverviewResponse;
  const result = await usage('from=2026-01-01&to=2026-12-31');
  expect(result.totals).toEqual({
    costUsd: overview.costUsd,
    tokens: overview.tokens,
  });
  for (const projectId of ['-fixture-alpha', '-fixture-beta']) {
    const detail = (await (
      await app.request(`/api/projects/${projectId}`)
    ).json()) as ProjectDetailResponse;
    const filtered = await usage(
      `from=2026-01-01&to=2026-12-31&projectId=${projectId}`,
    );
    expect(filtered.totals).toEqual({
      costUsd: detail.project.costUsd,
      tokens: detail.project.tokens,
    });
    expect(filtered.byProject).toHaveLength(1);
  }
});

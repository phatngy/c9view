import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import type { SessionDetailResponse } from '@c9view/api';
import { DataStore } from '../data/store.js';
import { startIndex } from '../data/start-index.js';
import { createApp } from '../test-app.js';
import { TRUNCATED_MARKER } from '../budget.js';

const MIB = 1_048_576;
const base = '/api/projects/-fixture-large/sessions/s';
// 120 tool results of ~20,000 characters each: about 2.4 MB of messages.
const COUNT = 240;
let dir: string;
let store: DataStore;
let runtime: ReturnType<typeof startIndex> | undefined;

function records() {
  const lines: unknown[] = [];
  for (let n = 0; n < COUNT / 2; n++) {
    lines.push({
      type: 'assistant',
      uuid: `a${n}`,
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        id: `a${n}`,
        model: 'fixture',
        content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: {} }],
      },
    });
    lines.push({
      type: 'user',
      uuid: `u${n}`,
      timestamp: '2026-01-01T00:00:01Z',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: `t${n}`,
            content: `output ${n} ` + 'y'.repeat(19_990),
          },
        ],
      },
    });
  }
  return lines;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-session-budget-'));
  vi.stubEnv('C9VIEW_STATE_DIR', join(dir, 'state'));
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', join(dir, 'legacy'));
  const claude = join(dir, 'claude');
  await mkdir(join(claude, 'projects/-fixture-large'), { recursive: true });
  await writeFile(
    join(claude, 'projects/-fixture-large/s.jsonl'),
    records()
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
  );
  store = new DataStore(
    loadConfig({
      C9VIEW_CLAUDE_DIR: claude,
      C9VIEW_DB: join(dir, 'index.sqlite'),
    }),
  );
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  store.hooks.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function page(
  app: ReturnType<typeof createApp>,
  query: string,
  budget = MIB,
) {
  const response = await app.request(`${base}?${query}`);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(budget);
  return JSON.parse(text) as SessionDetailResponse;
}

async function forward(app: ReturnType<typeof createApp>, budget = MIB) {
  const uuids: string[] = [];
  let cursor: number | null = 0;
  let pages = 0;
  while (cursor !== null) {
    const next = await page(app, `cursor=${cursor}&limit=1000`, budget);
    expect(next.cursor).toBe(cursor);
    uuids.push(...next.messages.map((m) => m.uuid));
    cursor = next.nextCursor;
    pages++;
  }
  return { uuids, pages };
}

async function backward(app: ReturnType<typeof createApp>, budget = MIB) {
  let current = await page(app, 'from=end&limit=1000', budget);
  const uuids = current.messages.map((m) => m.uuid);
  expect(current.cursor + current.messages.length).toBe(COUNT);
  while (current.prevCursor !== null) {
    const end = current.cursor;
    current = await page(
      app,
      `cursor=${current.prevCursor}&limit=${end - current.prevCursor}&fill=end`,
      budget,
    );
    // A backward page ends exactly where the later page starts.
    expect(current.cursor + current.messages.length).toBe(end);
    uuids.unshift(...current.messages.map((m) => m.uuid));
  }
  return uuids;
}

const expected = records().map((r) => (r as { uuid: string }).uuid);

describe.each(['file cache', 'SQLite index'])(
  'session pages from the %s',
  (source) => {
    async function app() {
      if (source === 'SQLite index') {
        runtime = startIndex(store.config, store);
        await runtime.ready;
        expect(store.readyIndex).toBeTruthy();
      }
      return createApp(store.config, { store });
    }

    it('stops under 1 MiB with a cursor; following cursors yields every message in order', async () => {
      const served = await app();
      const first = await page(served, 'cursor=0&limit=1000');
      expect(first.truncated).toBe(true);
      expect(first.nextCursor).toBe(first.messages.length);
      expect(first.messages.length).toBeLessThan(COUNT);
      const { uuids, pages } = await forward(served);
      expect(pages).toBeGreaterThan(1);
      expect(uuids).toEqual(expected);
    });

    it('pages backwards from the end without gaps', async () => {
      const served = await app();
      expect(await backward(served)).toEqual(expected);
    });
  },
);

it('cuts a message larger than the whole budget and keeps paging', async () => {
  const budget = 16_384;
  const served = createApp(store.config, {
    store,
    limits: { pageBudgetBytes: budget },
  });
  const first = await page(served, 'cursor=1&limit=10', budget);
  expect(first.truncated).toBe(true);
  expect(first.messages).toHaveLength(1);
  const message = first.messages[0]!;
  expect(message).toMatchObject({ uuid: 'u0', truncated: true });
  const text = JSON.stringify(message.blocks);
  expect(text).toContain(TRUNCATED_MARKER);
  expect(first.nextCursor).toBe(2);
  const { uuids } = await forward(served, budget);
  expect(uuids).toEqual(expected);
  expect(await backward(served, budget)).toEqual(expected);
});

it('leaves small pages as they were', async () => {
  const served = createApp(store.config, { store });
  const small = await page(served, 'cursor=0&limit=10');
  expect(small).toMatchObject({ cursor: 0, nextCursor: 10, prevCursor: null });
  expect(small).not.toHaveProperty('truncated');
  expect(small.messages).toHaveLength(10);
});

import { mkdtemp, writeFile, appendFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptCache } from './cache.js';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const user = (text: string) =>
  JSON.stringify({ type: 'user', message: { content: text } }) + '\n';
const assistant = (id: string, blocks: unknown[]) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      id,
      model: 'fixture',
      content: blocks,
      usage: { input_tokens: 10 },
    },
  }) + '\n';
describe('transcript cache', () => {
  it('reuses unchanged entries and reads only complete appended lines', async () => {
    const path = join(dir, 's.jsonl');
    await writeFile(path, user('first'));
    const cache = new TranscriptCache();
    const first = await cache.get(path, true);
    expect(await cache.get(path, true)).toBe(first);
    const offset = first.offset;
    await appendFile(path, user('second').slice(0, -1));
    expect((await cache.get(path, true)).offset).toBe(offset);
    await appendFile(path, '\n');
    const appended = await cache.get(path, true);
    expect(appended.records).toHaveLength(2);
    expect(appended.summary.messageCount).toBe(2);
  });
  it('invalidates truncated and same-size modified files', async () => {
    const path = join(dir, 's.jsonl');
    const cache = new TranscriptCache();
    await writeFile(path, user('first'));
    await cache.get(path, true);
    await writeFile(path, user('other'));
    await utimes(path, new Date(), new Date(Date.now() + 1000));
    expect((await cache.get(path, true)).preview).toBe('other');
    await writeFile(path, '');
    expect((await cache.get(path, true)).summary.messageCount).toBe(0);
  });
  it('evicts full records by request recency while preserving summaries and aggregate accounting', async () => {
    const cache = new TranscriptCache(2);
    const paths = ['a', 'b', 'c'].map((s) => join(dir, s));
    for (const path of paths) await writeFile(path, user(path));
    const a = await cache.get(paths[0]!, true);
    const b = await cache.get(paths[1]!, true);
    await cache.get(paths[0]!, true);
    await cache.get(paths[2]!, true);
    expect(cache.retainedRecordCount).toBe(2);
    expect(a.records).toHaveLength(1);
    expect(b.records).toBeUndefined();
    await appendFile(paths[1]!, user('append'));
    expect((await cache.get(paths[1]!)).summary.messageCount).toBe(2);
    expect((await cache.get(paths[1]!, true)).records).toHaveLength(2);
    expect(cache.retainedRecordCount).toBe(2);
  });
  it('tracks matched tools and replaces repeated usage snapshots across appends', async () => {
    const path = join(dir, 's.jsonl');
    const cache = new TranscriptCache();
    await writeFile(
      path,
      assistant('a', [{ type: 'tool_use', id: 't', name: 'Read', input: {} }]),
    );
    expect([...(await cache.get(path)).lastTools.values()]).toEqual(['Read']);
    await appendFile(
      path,
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't', content: 'done' }],
        },
      }) +
        '\n' +
        assistant('a', []),
    );
    const entry = await cache.get(path);
    expect(entry.lastTools.size).toBe(0);
    expect(entry.summary.usage.total.input).toBe(10);
    expect(entry.summary.messageCount).toBe(2);
  });
  it('serializes concurrent requests and warms summaries without retaining records', async () => {
    const path = join(dir, 's.jsonl');
    await writeFile(path, user('first'));
    const cache = new TranscriptCache();
    const entries = await Promise.all([
      cache.get(path),
      cache.get(path, true),
      cache.get(path, true),
    ]);
    expect(entries.map((e) => e.summary.messageCount)).toEqual([1, 1, 1]);
    expect(cache.retainedRecordCount).toBe(1);
  });
});

it('reloads growing rewrites with the same inode and rejects backwards mtimes', async () => {
  const path = join(dir, 'rewritten.jsonl');
  const cache = new TranscriptCache();
  await writeFile(path, user('old'));
  const old = await cache.get(path, true);
  await writeFile(path, user('replacement') + user('new'));
  const replaced = await cache.get(path, true);
  expect(replaced.ino).toBe(old.ino);
  expect(replaced.preview).toBe('new');
  expect(replaced.records?.[0]).toMatchObject({
    message: { content: 'replacement' },
  });
  expect(replaced.summary.messageCount).toBe(2);
  const forward = new Date(Date.now() + 60_000);
  await utimes(path, forward, forward);
  const future = await cache.get(path, true);
  await appendFile(path, user('third'));
  await utimes(path, new Date(), new Date());
  const backwards = await cache.get(path, true);
  expect(backwards).not.toBe(future);
  expect(backwards.summary.messageCount).toBe(3);
});
it('memoizes mapped messages and costs until the file changes, and releases accounting on eviction', async () => {
  const path = join(dir, 'a.jsonl');
  const other = join(dir, 'b.jsonl');
  await writeFile(path, assistant('a', []));
  await writeFile(other, user('other'));
  const cache = new TranscriptCache(1);
  const first = await cache.mapped(path);
  const again = await cache.mapped(path);
  expect(again.messages).toBe(first.messages);
  expect(again.entry.byModel).toBe(first.entry.byModel);
  await appendFile(path, assistant('b', []));
  const updated = await cache.mapped(path);
  expect(updated.messages).not.toBe(first.messages);
  expect(updated.entry.summary.usage.total.input).toBe(20);
  await cache.get(other, true);
  expect(updated.entry.records).toBeUndefined();
  expect(updated.entry.messages).toBeUndefined();
  expect(updated.entry.usage.size).toBe(0);
  expect(updated.entry.assistantIds.size).toBe(0);
  expect(updated.entry.toolIds.size).toBe(0);
  expect(updated.entry.byModel[0]?.tokens.input).toBe(20);
  await appendFile(path, assistant('b', []));
  const evicted = await cache.get(path);
  expect(evicted.summary.usage.total.input).toBe(20);
  expect(evicted.usage.size).toBe(0);
});

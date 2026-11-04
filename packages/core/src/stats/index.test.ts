import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readHistory, readStatsCache } from './index.js';

const roots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'c9view-stats-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('stats readers', () => {
  it('returns null for a missing cache and validates cache data while preserving extensions', async () => {
    const dir = await makeTempDir();
    expect(await readStatsCache(dir)).toBeNull();
    const cache = {
      dailyActivity: [
        {
          date: '2026-01-01',
          messageCount: 2,
          sessionCount: 1,
          toolCallCount: 3,
        },
      ],
      dailyModelTokens: [{ date: '2026-01-01', tokensByModel: { model: 12 } }],
      firstSessionDate: '2026-01-01T00:00:00Z',
      hourCounts: { '9': 2 },
      lastComputedDate: '2026-01-01',
      longestSession: {
        sessionId: 'session',
        duration: 12,
        messageCount: 2,
        timestamp: '2026-03-07T10:29:51.281Z',
      },
      modelUsage: {
        model: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 4,
          webSearchRequests: 0,
          costUSD: 0,
          futureField: true,
        },
      },
      totalMessages: 2,
      totalSessions: 1,
      version: 4,
      futureTopLevel: 'preserved',
    };
    await writeFile(path.join(dir, 'stats-cache.json'), JSON.stringify(cache));
    expect(await readStatsCache(dir)).toEqual(cache);
  });

  it('tolerates changed nested fields and defaults incomplete model usage entries', async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, 'stats-cache.json'),
      JSON.stringify({
        longestSession: { timestamp: '2026-03-07T10:29:51.281Z', extra: true },
        modelUsage: {
          model: {
            inputTokens: 'changed',
            contextWindow: 200_000,
            maxOutputTokens: 8_192,
          },
        },
        futureTopLevel: true,
      }),
    );
    const cache = await readStatsCache(dir);
    expect(cache?.longestSession.timestamp).toBe('2026-03-07T10:29:51.281Z');
    expect(cache?.modelUsage.model).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      contextWindow: 200_000,
      maxOutputTokens: 8_192,
    });
    expect(cache?.futureTopLevel).toBe(true);
  });

  it('skips malformed history lines and returns the newest requested entries', async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, 'history.jsonl'),
      [
        JSON.stringify({ display: 'first', timestamp: 1, project: '/one' }),
        '{bad json',
        JSON.stringify({
          display: 'invalid shape',
          timestamp: 'bad',
          project: '/one',
        }),
        JSON.stringify({
          display: 'second',
          timestamp: 2,
          project: '/two',
          sessionId: 's2',
        }),
      ].join('\n'),
    );
    expect((await readHistory(dir)).map(({ display }) => display)).toEqual([
      'first',
      'second',
    ]);
    expect(
      (await readHistory(dir, { limit: 1 })).map(({ display }) => display),
    ).toEqual(['second']);
    expect(await readHistory(dir, { limit: 0 })).toEqual([]);
  });
});

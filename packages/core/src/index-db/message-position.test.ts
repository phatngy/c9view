import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { indexSession, openIndex } from './indexer.js';
import { getMessagePosition, getMessages } from './queries.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

// Pairs of assistant and user messages, plus a summary line that no page shows.
const lines = [
  { type: 'summary', summary: 'fixture', leafUuid: 'x' },
  ...Array.from({ length: 6 }, (_, n) => [
    // A record no page shows sits between visible rows.
    { type: 'summary', summary: `fixture ${n}`, leafUuid: `x${n}` },
    {
      type: 'assistant',
      uuid: `a${n}`,
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        id: `m${n}`,
        model: 'fixture',
        content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: {} }],
      },
    },
    {
      type: 'user',
      uuid: `u${n}`,
      timestamp: '2026-01-01T00:00:01Z',
      message: { content: [{ type: 'text', text: `reply ${n}` }] },
    },
  ]).flat(),
];

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'c9view-position-'));
  temporary.push(dir);
  const projectDir = path.join(dir, 'projects/-synthetic-position');
  await mkdir(projectDir, { recursive: true });
  const file = path.join(projectDir, 'pos.jsonl');
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const db = openIndex(':memory:');
  await indexSession(db, file);
  return db;
}

describe('getMessagePosition', () => {
  it('finds the first, a middle and the last message', async () => {
    const db = await setup();
    try {
      expect(getMessagePosition(db, 'pos', 'a0')).toEqual({
        ordinal: 0,
        total: 12,
      });
      expect(getMessagePosition(db, 'pos', 'u2')).toEqual({
        ordinal: 5,
        total: 12,
      });
      expect(getMessagePosition(db, 'pos', 'u5')).toEqual({
        ordinal: 11,
        total: 12,
      });
    } finally {
      db.close();
    }
  });

  it('agrees with the paging order for every message', async () => {
    const db = await setup();
    try {
      const visible = getMessages(db, 'pos', { limit: 1000 }).filter((m) =>
        ['user', 'assistant', 'system'].includes(m.type),
      );
      expect(visible).toHaveLength(12);
      visible.forEach((m, index) =>
        expect(getMessagePosition(db, 'pos', m.uuid)?.ordinal).toBe(index),
      );
    } finally {
      db.close();
    }
  });

  it('resolves a tool call id to the message that made it', async () => {
    const db = await setup();
    try {
      expect(getMessagePosition(db, 'pos', 't3')?.ordinal).toBe(6);
    } finally {
      db.close();
    }
  });

  it('returns undefined for a missing message or session', async () => {
    const db = await setup();
    try {
      expect(getMessagePosition(db, 'pos', 'missing')).toBeUndefined();
      expect(getMessagePosition(db, 'other', 'a0')).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

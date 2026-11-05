import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  warnPageBudget,
  budgetItems,
  budgetOffsetPage,
  encodedBytes,
  fitHunks,
  fitText,
  readOffsetCursor,
  TRUNCATED_MARKER,
} from './budget.js';

const item = (n: number, size = 100) => ({ n, text: 'x'.repeat(size) });

describe('budgetItems', () => {
  it('stops before the budget, measured as encoded JSON', () => {
    const items = Array.from({ length: 50 }, (_, n) => item(n));
    const envelope = { items: [] as unknown[], cursor: null };
    const budget = 1000;
    const page = budgetItems(items, {
      envelopeBytes: encodedBytes(envelope),
      budgetBytes: budget,
    });
    expect(page.more).toBe(true);
    expect(page.count).toBeGreaterThan(1);
    expect(
      encodedBytes({ ...envelope, items: page.items }),
    ).toBeLessThanOrEqual(budget);
    // One more item would not have fitted.
    expect(
      encodedBytes({ ...envelope, items: items.slice(0, page.count + 1) }),
    ).toBeGreaterThan(budget);
  });

  it('counts multi-byte characters and JSON escapes, not string length', () => {
    const items = ['é'.repeat(100), '"'.repeat(100), '\u0001'.repeat(100)];
    for (const text of items) {
      const page = budgetItems([text, text], {
        envelopeBytes: 2,
        budgetBytes: encodedBytes([text]) + 1,
      });
      expect(page.count).toBe(1);
      expect(page.more).toBe(true);
    }
  });

  it('keeps whole items and never cuts JSON', () => {
    const items = Array.from({ length: 20 }, (_, n) => item(n, 37));
    const page = budgetItems(items, { envelopeBytes: 2, budgetBytes: 300 });
    expect(page.items).toEqual(items.slice(0, page.count));
    expect(() => JSON.parse(JSON.stringify(page.items))).not.toThrow();
  });

  it('takes items from the end when asked', () => {
    const items = Array.from({ length: 10 }, (_, n) => item(n));
    const page = budgetItems(items, {
      envelopeBytes: 2,
      budgetBytes: 3 * encodedBytes(item(0)) + 4,
      fromEnd: true,
    });
    expect(page.items.map((i) => i.n)).toEqual([7, 8, 9]);
    expect(page.more).toBe(true);
  });

  it('truncates an oversized single item with a marker and leaves a cursor', () => {
    const items = [item(0, 10_000), item(1)];
    const page = budgetItems(items, {
      envelopeBytes: 2,
      budgetBytes: 1000,
      shrink: (value, room) => ({
        ...value,
        text: fitText(value.text, room - encodedBytes({ ...value, text: '' })),
      }),
    });
    expect(page).toMatchObject({ count: 1, more: true, truncated: true });
    expect(page.items[0]!.text.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(encodedBytes(page.items)).toBeLessThanOrEqual(1000);
    const offset = budgetOffsetPage(items, 0, 1000, 2, (value, room) => ({
      ...value,
      text: fitText(value.text, room - encodedBytes({ ...value, text: '' })),
    }));
    expect(offset).toMatchObject({ nextCursor: '1', truncated: true });
  });

  it('sends an oversized item whole when it cannot be shrunk, so paging progresses', () => {
    const page = budgetItems([item(0, 5000)], {
      envelopeBytes: 2,
      budgetBytes: 100,
    });
    expect(page).toMatchObject({ count: 1, more: false, truncated: false });
  });
});

describe('fitText and fitHunks', () => {
  it('fits encoded text without splitting a surrogate pair', () => {
    const text = '😀'.repeat(100);
    const fitted = fitText(text, 101);
    expect(encodedBytes(fitted)).toBeLessThanOrEqual(101);
    expect(fitted.endsWith(TRUNCATED_MARKER)).toBe(true);
    expect(fitted.replace(TRUNCATED_MARKER, '')).toMatch(/^(😀)*$/u);
  });

  it('keeps whole hunks, then the lines that fit', () => {
    const hunk = (n: number) => ({
      oldStart: n,
      oldLines: 10,
      newStart: n,
      newLines: 10,
      lines: Array.from({ length: 10 }, (_, i) => `+line ${n}.${i}`),
    });
    const hunks = [hunk(1), hunk(2), hunk(3)];
    const room = encodedBytes([hunk(1)]) + 80;
    const fitted = fitHunks(hunks, room);
    expect(fitted.cut).toBe(true);
    expect(fitted.hunks[0]).toEqual(hunk(1));
    expect(fitted.hunks[1]!.lines.length).toBeGreaterThan(0);
    expect(fitted.hunks[1]!.lines.length).toBeLessThan(10);
    expect(encodedBytes(fitted.hunks)).toBeLessThanOrEqual(room);
  });
});

it('reads offset cursors and rejects anything else', () => {
  expect(readOffsetCursor(undefined)).toBe(0);
  expect(readOffsetCursor('12')).toBe(12);
  for (const raw of ['-1', '1.5', 'abc', '9'.repeat(16), ''])
    expect(readOffsetCursor(raw)).toBeNull();
});

it('never cuts inside a redaction mask, including its opening', () => {
  const prefix = 'safe '.repeat(30);
  const mask = '«redacted:api-key»';
  const text = prefix + mask + 'x'.repeat(500);
  for (let n = 1; n < mask.length; n++) {
    const fitted = fitText(
      text,
      encodedBytes(prefix + mask.slice(0, n) + TRUNCATED_MARKER),
    );
    expect(fitted).toBe(prefix + TRUNCATED_MARKER);
  }
  expect(fitText(text, -1)).toBe('');
});

it('cuts an oversized diff line to show the start of a minified file', () => {
  const hunk = {
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    lines: ['+const minified = ' + 'x'.repeat(10000)],
  };
  const fitted = fitHunks([hunk], 300);
  expect(fitted.cut).toBe(true);
  expect(fitted.hunks[0]?.lines[0]).toMatch(/^\+const minified = /);
  expect(fitted.hunks[0]?.lines[0]).toContain(TRUNCATED_MARKER);
  expect(encodedBytes(fitted.hunks)).toBeLessThanOrEqual(300);
  expect(fitHunks([hunk], 0)).toEqual({ hunks: [], cut: true });
});

it.each(['', '«', '«redacted:x»'])(
  'fits a redaction boundary at %j exactly',
  (boundary) => {
    const prefix = 'safe ';
    const text = prefix + (boundary || '«redacted:x»') + 'x'.repeat(200);
    const room = encodedBytes(prefix + boundary + TRUNCATED_MARKER);
    const expected = boundary === '«redacted:x»' ? prefix + boundary : prefix;
    expect(fitText(text, room)).toBe(expected + TRUNCATED_MARKER);
  },
);

it('serializes the measured wire text once and warns with UTF-8 byte counts only', () => {
  const toJSON = vi.fn(() => ({ text: 'é', optional: undefined }));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const text = warnPageBudget('files', { toJSON }, 1);
    expect(text).toBe('{"text":"é"}');
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `files: ${Buffer.byteLength(text)} bytes > 1 bytes`,
    );
  } finally {
    warn.mockRestore();
  }
});

it('returns measured JSON with the same status, headers and bytes as c.json', async () => {
  const payload = {
    text: 'é\n«redacted:x»',
    absent: undefined,
    nextCursor: null,
  };
  const app = new Hono();
  app.get('/original', (c) => c.json(payload));
  app.get('/measured', (c) =>
    c.body(warnPageBudget('files', payload, 1000), 200, {
      'content-type': 'application/json',
    }),
  );
  const original = await app.request('/original');
  const measured = await app.request('/measured');
  expect(measured.status).toBe(original.status);
  expect([...measured.headers]).toEqual([...original.headers]);
  expect(await measured.text()).toBe(await original.text());
});

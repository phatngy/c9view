import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { costOf, loadPrices, resolvePrice, type ModelPrice } from './prices.js';

const testPrice: ModelPrice = {
  input: 1,
  output: 2,
  cacheRead: 0.1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
};

describe('pricing', () => {
  it('resolves exact names, date suffixes, provider prefixes, and latest families', () => {
    const table = {
      source: 'test',
      date: '2026-10-24',
      prices: {
        'claude-sonnet-5-5': testPrice,
        'claude-sonnet-4-5': { ...testPrice, input: 3 },
        'claude-opus-5-5': { ...testPrice, output: 4 },
        'claude-haiku-5-5': { ...testPrice, output: 6 },
        'claude-fable-5-1': { ...testPrice, output: 8 },
        'claude-mythos-5-1': { ...testPrice, output: 10 },
        'claude-3-5-haiku-20241022': { ...testPrice, output: 12 },
        'claude-3-opus-20240229': { ...testPrice, output: 14 },
      },
    };
    expect(resolvePrice(table, 'claude-sonnet-5-5')).toEqual({
      price: testPrice,
      matchedAs: 'claude-sonnet-5-5',
      exact: true,
    });
    expect(resolvePrice(table, 'claude-sonnet-4-5-20250929')?.matchedAs).toBe(
      'claude-sonnet-4-5',
    );
    expect(resolvePrice(table, 'anthropic/claude-sonnet-5-5')?.matchedAs).toBe(
      'claude-sonnet-5-5',
    );
    expect(resolvePrice(table, 'claude-sonnet-unknown')?.matchedAs).toBe(
      'claude-sonnet-5-5',
    );
    expect(resolvePrice(table, 'opus')?.matchedAs).toBe('claude-opus-5-5');
    expect(resolvePrice(table, 'sonnet')?.matchedAs).toBe('claude-sonnet-5-5');
    expect(resolvePrice(table, 'haiku')?.matchedAs).toBe('claude-haiku-5-5');
    expect(resolvePrice(table, 'fable')?.matchedAs).toBe('claude-fable-5-1');
    expect(resolvePrice(table, 'mythos')?.matchedAs).toBe('claude-mythos-5-1');
    const legacyTable = {
      ...table,
      prices: {
        'claude-3-5-haiku-20241022': testPrice,
        'claude-3-opus-20240229': testPrice,
      },
    };
    expect(
      resolvePrice(legacyTable, 'claude-3-5-haiku-some-suffix')?.matchedAs,
    ).toBe('claude-3-5-haiku-20241022');
    expect(
      resolvePrice(legacyTable, 'claude-3-opus-some-suffix')?.matchedAs,
    ).toBe('claude-3-opus-20240229');
    expect(resolvePrice(table, '<synthetic>')).toBeNull();
  });

  it('calculates USD cost and splits total cache creation around 1h writes', () => {
    expect(
      costOf(
        {
          input: 100_000,
          output: 10_000,
          cacheRead: 20_000,
          cacheCreation: 4_000,
        },
        testPrice,
      ),
    ).toBeCloseTo(0.127, 6);
    expect(
      costOf({ cacheCreation5m: 1_000, cacheCreation1h: 1_000 }, testPrice),
    ).toBeCloseTo(0.00325, 6);
    expect(
      costOf({ cacheCreation: 2_000, cacheCreation1h: 1_000 }, testPrice),
    ).toBeCloseTo(0.00325, 6);
  });

  it('uses Haiku long-context rates when one request exceeds 100k prompt tokens', async () => {
    const table = await loadPrices();
    const price = table.prices['claude-haiku-5-5'];
    expect(price?.longContext?.thresholdTokens).toBe(100_000);
    expect(price).toBeDefined();
    expect(costOf({ input: 100_000 }, price!)).toBeCloseTo(0.01, 8);
    expect(costOf({ input: 100_001 }, price!)).toBeCloseTo(0.0500005, 8);
    expect(costOf({ input: 1, cacheRead: 100_000 }, price!)).toBeCloseTo(
      0.0050005,
      8,
    );
  });

  it('merges override prices over bundled defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'c9view-prices-'));
    try {
      const path = join(directory, 'prices.json');
      await writeFile(
        path,
        JSON.stringify({
          source: 'override',
          date: 'today',
          prices: { 'claude-opus-5-5': testPrice },
        }),
      );
      const table = await loadPrices({ overridePath: path });
      expect(table.prices['claude-opus-5-5']).toEqual(testPrice);
      expect(table.prices['claude-sonnet-5-5']?.input).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('falls back to bundled prices when latest pricing fetch fails', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      throw new Error('offline');
    };
    const table = await loadPrices({ fetchLatest: true, fetchImpl });
    expect(table.prices['claude-opus-5-5']?.input).toBe(4);
    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });
});

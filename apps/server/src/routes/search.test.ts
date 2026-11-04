import { expect, it } from 'vitest';
import { mergeRanges, queryTokens, snippet } from './search.js';

it('uses unicode tokens, punctuation boundaries, accent folding and prefix markers', () => {
  expect(queryTokens('*Café,東京 a*')).toEqual([
    { term: 'cafe', prefix: false },
    { term: '東京', prefix: false },
    { term: 'a', prefix: true },
  ]);
  expect(snippet('alphabet a cat Café 東京', 'a*').highlights).toEqual([
    [0, 8],
    [9, 10],
  ]);
  expect(snippet('cat concatenate', 'cat').highlights).toEqual([[0, 3]]);
  expect(snippet('Café 東京', 'cafe,東京').highlights).toEqual([
    [0, 4],
    [5, 7],
  ]);
});
it('never highlights inside redaction placeholders', () => {
  const result = snippet(
    '«redacted:api-key» redacted api key',
    'redacted api key',
  );
  for (const [start, end] of result.highlights)
    expect(result.snippet.slice(start, end)).toMatch(/^(redacted|api|key)$/);
  expect(result.highlights).toHaveLength(3);
  expect(result.highlights.every(([start]) => start > 17)).toBe(true);
});
it('merges duplicate and overlapping prefix matches and sorts ranges', () => {
  expect(
    snippet('beta alphabet', 'alphabet alpha* a* beta beta').highlights,
  ).toEqual([
    [0, 4],
    [5, 13],
  ]);
});

it('merges adjacent and overlapping ranges in sorted order', () => {
  expect(
    mergeRanges([
      [4, 7],
      [0, 2],
      [2, 4],
      [1, 3],
      [10, 11],
    ]),
  ).toEqual([
    [0, 7],
    [10, 11],
  ]);
});

it('reports cut flags at the start, text end, and both window edges', () => {
  expect(snippet('hello world', 'hello')).toMatchObject({
    cutStart: false,
    cutEnd: false,
  });
  expect(snippet(`hello ${'x '.repeat(150)}`, 'hello')).toMatchObject({
    cutStart: false,
    cutEnd: true,
  });
  expect(snippet(`${'x '.repeat(150)}hello`, 'hello')).toMatchObject({
    cutStart: true,
    cutEnd: false,
  });
  expect(
    snippet(`${'x '.repeat(150)}hello ${'x '.repeat(150)}`, 'hello'),
  ).toMatchObject({ cutStart: true, cutEnd: true });
});

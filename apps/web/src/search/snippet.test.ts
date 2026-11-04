import { expect, it } from 'vitest';
import { cleanSnippet } from './snippet.js';

it('strips opening, closing and self-closing tags while keeping inner text', () => {
  const snippet =
    '<teammate-message teammate_id="x"><status>Ready</status> <command-name>/test</command-name><local-command-stdout> Passed.</local-command-stdout><system-reminder /></teammate-message>';
  const start = snippet.indexOf('Passed');
  expect(cleanSnippet({ snippet, highlights: [[start, start + 6]] })).toEqual({
    snippet: 'Ready /test Passed.',
    highlights: [[12, 18]],
  });
});

it('drops matches inside removed tag text and clips partially overlapping ranges', () => {
  expect(
    cleanSnippet({
      snippet: '<status>Ready</status>',
      highlights: [
        [1, 7],
        [2, 11],
        [11, 18],
      ],
    }),
  ).toEqual({
    snippet: 'Ready',
    highlights: [[0, 5]],
  });
});

it('collapses whitespace and remaps matches across removed tags', () => {
  expect(
    cleanSnippet({
      snippet: '  Hello \n <status>  world</status>!  ',
      highlights: [
        [2, 7],
        [7, 19],
        [20, 25],
      ],
    }),
  ).toEqual({
    snippet: 'Hello\nworld!',
    highlights: [[0, 11]],
  });
});

it('trims partial edge words and adds ellipses at both cut ends', () => {
  expect(
    cleanSnippet({
      snippet: 'iner. I also found the res',
      cutStart: true,
      cutEnd: true,
      highlights: [[8, 12]],
    }),
  ).toEqual({
    snippet: '…I also found the…',
    highlights: [[3, 7]],
  });
});

it('preserves lowercase complete text without cut metadata', () => {
  expect(
    cleanSnippet({
      snippet: 'hello world',
      highlights: [
        [0, 5],
        [6, 11],
      ],
    }),
  ).toEqual({
    snippet: 'hello world',
    highlights: [
      [0, 5],
      [6, 11],
    ],
  });
});

it('keeps matches at complete snippet boundaries without adding ellipses', () => {
  expect(
    cleanSnippet({
      snippet: 'Hello world!',
      highlights: [
        [0, 5],
        [6, 11],
      ],
    }),
  ).toEqual({
    snippet: 'Hello world!',
    highlights: [
      [0, 5],
      [6, 11],
    ],
  });
});

it('returns an empty snippet for all-tag and whitespace-only input', () => {
  for (const snippet of ['<status></status><system-reminder />', ' \n ', '']) {
    expect(
      cleanSnippet({ snippet, highlights: [[0, snippet.length]] }),
    ).toEqual({ snippet: '', highlights: [] });
  }
});

it('handles a single cut word without losing its match', () => {
  expect(
    cleanSnippet({
      snippet: 'partial',
      highlights: [],
      cutStart: true,
      cutEnd: true,
    }),
  ).toEqual({
    snippet: '…',
    highlights: [],
  });
  expect(
    cleanSnippet({
      snippet: 'partial',
      highlights: [[2, 5]],
      cutStart: true,
      cutEnd: true,
    }),
  ).toEqual({
    snippet: '…partial…',
    highlights: [[3, 6]],
  });
});

it('leaves comparisons and quoted angle brackets intact', () => {
  expect(
    cleanSnippet({ snippet: 'Use a < b and c > d.', highlights: [] }).snippet,
  ).toBe('Use a < b and c > d.');
  expect(
    cleanSnippet({
      snippet: '<status value="a > b">Ready.</status>',
      highlights: [],
    }).snippet,
  ).toBe('Ready.');
});

it('remaps UTF-16 offsets and clips invalid ranges safely', () => {
  expect(
    cleanSnippet({
      snippet: '<status>😀 café.</status>',
      highlights: [
        [8, 10],
        [11, 15],
        [-3, 9],
        [4, 4],
        [90, 99],
        [NaN, 3],
      ],
    }),
  ).toEqual({
    snippet: '😀 café.',
    highlights: [
      [0, 2],
      [3, 7],
    ],
  });
});

it.each([undefined, false])('keeps uncut words with flags %s', (flag) => {
  expect(
    cleanSnippet({
      snippet: 'hello world',
      highlights: [],
      ...(flag === undefined ? {} : { cutStart: flag, cutEnd: flag }),
    }),
  ).toEqual({ snippet: 'hello world', highlights: [] });
});

it.each(['Array<string>', 'a<b && c>d', '<div>Hello</div>', '<b>bold</b>'])(
  'preserves source syntax: %s',
  (snippet) => {
    expect(
      cleanSnippet({ snippet, highlights: [[0, snippet.length]] }),
    ).toEqual({ snippet, highlights: [[0, snippet.length]] });
  },
);

it('removes cut tag fragments only at flagged edges', () => {
  const snippet = 'mate-message>Ready <command-name arg="unfinished';
  expect(
    cleanSnippet({
      snippet,
      highlights: [[13, 18]],
      cutStart: true,
      cutEnd: true,
    }),
  ).toEqual({ snippet: '…Ready…', highlights: [[1, 6]] });
  expect(cleanSnippet({ snippet, highlights: [] }).snippet).toBe(snippet);
  expect(
    cleanSnippet({ snippet: 'id="x">Ready.', highlights: [], cutStart: true })
      .snippet,
  ).toBe('…Ready.');
  expect(
    cleanSnippet({ snippet: 'a> Ready.', highlights: [[0, 1]], cutStart: true })
      .snippet,
  ).toBe('…a> Ready.');
});

it('preserves multiline lists and collapses whitespace runs as units', () => {
  const snippet =
    ' \t- first\t  item \t\n<status> \n\n\n</status> - second\n- third \n ';
  expect(cleanSnippet({ snippet, highlights: [] }).snippet).toBe(
    '- first item\n\n- second\n- third',
  );
});

it('remaps a highlight spanning a newline and a two-newline unit', () => {
  const snippet = 'first \t\n<status>\n\n</status> second\nthird';
  expect(
    cleanSnippet({ snippet, highlights: [[3, snippet.length - 2]] }),
  ).toEqual({ snippet: 'first\n\nsecond\nthird', highlights: [[3, 17]] });
});

it('sorts and merges overlapping output ranges after whitespace collapse', () => {
  expect(
    cleanSnippet({
      snippet: 'a \t  b c',
      highlights: [
        [5, 8],
        [2, 4],
        [0, 3],
      ],
    }),
  ).toEqual({ snippet: 'a b c', highlights: [[0, 5]] });
});

it('drops recognized single-word tag tails even when highlighted', () => {
  for (const tail of ['message>', '/status>', 'tus>']) {
    expect(
      cleanSnippet({
        snippet: `${tail}Ready.`,
        highlights: [[0, tail.length]],
        cutStart: true,
      }),
    ).toEqual({ snippet: '…Ready.', highlights: [] });
  }
});

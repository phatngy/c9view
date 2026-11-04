import { expect, it } from 'vitest';
import { parseRecord } from '@c9view/core';
import { inlineChanges } from './inline-changes.js';
it('caps inline diff lines at 2000 and reports truncation', () => {
  const records = [
    parseRecord({
      type: 'assistant',
      message: {
        id: 'a',
        model: 'fixture',
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'Write',
            input: {
              file_path: '/project/file',
              content: 'new\n'.repeat(2500),
            },
          },
        ],
      },
    }),
  ];
  const change = inlineChanges(records).get('t')!;
  expect(change.truncated).toBe(true);
  expect(change.hunks.reduce((n, h) => n + h.lines.length, 0)).toBe(2000);
});

it('memoizes inline extraction for an unchanged transcript array', () => {
  const records = [
    parseRecord({ type: 'user', message: { content: 'fixture' } }),
  ];
  expect(inlineChanges(records)).toBe(inlineChanges(records));
  expect(inlineChanges([...records])).not.toBe(inlineChanges(records));
});

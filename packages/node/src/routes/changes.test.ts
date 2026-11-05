import { expect, it } from 'vitest';
import type { SessionFileDiffResponse } from '@c9view/api';
import { encodedBytes } from '../budget.js';
import { fitFileDiff } from './changes.js';

it('preserves original step counts when cutting hunks and marks dropped steps on the diff', () => {
  const hunks = [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: ['-' + 'x'.repeat(5000), '+' + 'y'.repeat(5000)],
    },
  ];
  const step: SessionFileDiffResponse['steps'][number] = {
    toolUseId: 't',
    messageUuid: 'm',
    timestamp: null,
    tool: 'Edit',
    filePath: '/fixture/file',
    kind: 'update',
    hunks,
    additions: 1,
    deletions: 1,
    source: 'computed',
    userModified: false,
  };
  const response: SessionFileDiffResponse = {
    fileId: 'f',
    filePath: '/fixture/file',
    hunks,
    additions: 1,
    deletions: 1,
    source: 'tool-hunks',
    steps: [step, { ...step, toolUseId: 't2' }],
    tooLarge: false,
    partial: false,
  };
  const fitted = fitFileDiff(response, 1500);
  expect(fitted.truncated).toBe(true);
  expect(fitted.steps).toHaveLength(1);
  expect(fitted.steps[0]).toMatchObject({ additions: 1, deletions: 1 });
  expect(fitted.steps[0]?.hunks).not.toEqual(hunks);
  expect(encodedBytes(fitted)).toBeLessThanOrEqual(1500);
  const tiny = fitFileDiff(response, 1);
  expect(tiny).toMatchObject({
    truncated: true,
    hunks: [],
    steps: [{ hunks: [] }],
  });
});

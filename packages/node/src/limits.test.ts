import { expect, it } from 'vitest';
import { DEFAULT_NODE_LIMITS, loadNodeLimits } from './limits.js';

it('uses documented defaults and ignores unrelated environment variables', () => {
  expect(loadNodeLimits({ UNRELATED: 'invalid' })).toEqual({
    requestBodyMaxBytes: 49152,
    responseChunkMaxBytes: 262144,
    requestDeadlineMs: 30000,
    requestIdleMs: 10000,
    maxOpenRequests: 16,
    pageBudgetBytes: 1048576,
    fileBudgetBytes: 8388608,
  });
});
const variables = [
  ['C9VIEW_REQUEST_BODY_MAX_BYTES', 'requestBodyMaxBytes'],
  ['C9VIEW_RESPONSE_CHUNK_MAX_BYTES', 'responseChunkMaxBytes'],
  ['C9VIEW_REQUEST_DEADLINE_MS', 'requestDeadlineMs'],
  ['C9VIEW_REQUEST_IDLE_MS', 'requestIdleMs'],
  ['C9VIEW_NODE_MAX_OPEN_REQUESTS', 'maxOpenRequests'],
  ['C9VIEW_PAGE_BUDGET_BYTES', 'pageBudgetBytes'],
  ['C9VIEW_FILE_BUDGET_BYTES', 'fileBudgetBytes'],
] as const;
it.each(variables)(
  'accepts positive integer overrides for %s',
  (variable, key) => {
    expect(loadNodeLimits({ [variable]: '123' })).toEqual({
      ...DEFAULT_NODE_LIMITS,
      [key]: 123,
    });
  },
);
it.each(variables)('names %s when rejecting invalid limits', (variable) => {
  for (const value of [
    '0',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '',
    ' ',
    '1e3',
    '9007199254740992',
  ]) {
    expect(() => loadNodeLimits({ [variable]: value })).toThrow(variable);
  }
});

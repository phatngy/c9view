import { expect, it } from 'vitest';
import { sessions } from '../test-fixtures.js';
import { boardColumns, selectSessions } from './sessions.js';

const low = {
  ...sessions[1]!,
  id: 'low',
  title: 'Alpha',
  models: ['claude-haiku'],
  gitBranch: 'alpha',
  lastAt: '2026-10-01T00:00:00Z',
  messageCount: 2,
  costUsd: 0.01,
  tokens: { ...sessions[1]!.tokens, output: 1 },
  status: { ...sessions[1]!.status, reason: 'A request' },
};
const high = {
  ...sessions[2]!,
  id: 'high',
  title: 'Zulu',
  models: ['claude-opus'],
  gitBranch: 'zulu',
  lastAt: '2026-10-02T00:00:00Z',
  messageCount: 12,
  costUsd: 1,
  tokens: { ...sessions[2]!.tokens, output: 100 },
  status: { ...sessions[2]!.status, reason: 'Working' },
};
it.each([
  'title',
  'status',
  'model',
  'branch',
  'activity',
  'messages',
  'tokens',
  'cost',
])('sorts %s in both directions using session data', (field) => {
  expect(
    selectSessions([high, low], '', `${field}-asc`).map((s) => s.id),
  ).toEqual(['low', 'high']);
  expect(
    selectSessions([low, high], '', `${field}-desc`).map((s) => s.id),
  ).toEqual(['high', 'low']);
});
it.each([' ALPHA ', 'HaIkU', 'aLpHa'])(
  'filters titles, models and branches case-insensitively: %s',
  (filter) => {
    expect(selectSessions([high, low], filter, 'activity-desc')).toEqual([low]);
  },
);
it('keeps null branches and activity sortable and leaves the source array intact', () => {
  const missing = { ...low, id: 'missing', gitBranch: null, lastAt: null };
  const input = [high, missing];
  expect(selectSessions(input, '', 'activity-asc')).toEqual([missing, high]);
  expect(selectSessions(input, '', 'branch-asc')).toEqual([missing, high]);
  expect(input).toEqual([high, missing]);
});

it('sorts statuses by the board urgency order', () => {
  const input = [...sessions].reverse();
  expect(
    selectSessions(input, '', 'status-asc').map(
      (session) => session.status.column,
    ),
  ).toEqual(boardColumns);
  expect(
    selectSessions(input, '', 'status-desc').map(
      (session) => session.status.column,
    ),
  ).toEqual([...boardColumns].reverse());
});

it('orders equal status values by session id', () => {
  const first = {
    ...low,
    id: 'alpha',
    status: { ...low.status, column: 'inactive' as const },
  };
  const second = {
    ...high,
    id: 'zulu',
    status: { ...high.status, column: 'inactive' as const },
  };
  expect(
    selectSessions([second, first], '', 'status-asc').map(({ id }) => id),
  ).toEqual(['alpha', 'zulu']);
});

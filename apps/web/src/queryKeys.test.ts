import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { queryKeys } from './queryKeys.js';

it('isolates identical project and session IDs on different machines', () => {
  const client = new QueryClient();
  for (const machine of ['alpha', 'beta']) {
    client.setQueryData(queryKeys.project(machine, 'p'), machine);
    client.setQueryData(queryKeys.session(machine, 'p', 's'), machine);
  }
  expect(client.getQueryData(queryKeys.project('alpha', 'p'))).toBe('alpha');
  expect(client.getQueryData(queryKeys.session('beta', 'p', 's'))).toBe('beta');
  expect(client.getQueryCache().getAll()).toHaveLength(4);
  client.clear();
});

it('keeps hub keys global', () => {
  expect(queryKeys.machines()).toEqual(['machines']);
  expect(queryKeys.hubHealth()).toEqual(['hub-health']);
});

it('prefixes every node query factory with its machine', () => {
  const machine = 'remote';
  const keys = [
    queryKeys.overview(machine),
    queryKeys.projects(machine),
    queryKeys.project(machine, 'p'),
    queryKeys.session(machine, 'p', 's'),
    queryKeys.sessionPoll(machine, 'p', 's'),
    queryKeys.statusHistory(machine, 'p', 's'),
    queryKeys.config(machine),
    queryKeys.health(machine),
    queryKeys.search(machine, {
      q: '',
      projectId: '',
      from: '',
      to: '',
      model: '',
    }),
    queryKeys.usage(machine, { projectId: '', from: '', to: '', tz: 'UTC' }),
    queryKeys.files(machine, 'p', ''),
    queryKeys.file(machine, 'p', 'a'),
    queryKeys.gitStatus(machine, 'p'),
    queryKeys.gitDiff(machine, 'p', 'a'),
    queryKeys.changes(machine, 'p', 's'),
    queryKeys.change(machine, 'p', 's', 'f'),
  ];
  expect(keys.every((key) => key[0] === machine)).toBe(true);
});

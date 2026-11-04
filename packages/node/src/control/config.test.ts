import { expect, it, vi } from 'vitest';
import { accessSync } from 'node:fs';
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, accessSync: vi.fn(actual.accessSync) };
});
import { loadControlConfig } from './config.js';
it('T005 defaults and explicit overrides', () => {
  expect(loadControlConfig({})).toMatchObject({
    control: false,
    bypass: false,
    maxRuns: 3,
    idleMin: 10,
    approvalMin: 30,
    receiptMin: 10,
    tombstoneMax: 100000,
    textMaxChars: 20000,
  });
  expect(
    loadControlConfig({ C9VIEW_CONTROL: '1' }, { control: false }).control,
  ).toBe(false);
});
it.each([
  'C9VIEW_CONTROL_MAX_RUNS',
  'C9VIEW_CONTROL_IDLE_MIN',
  'C9VIEW_CONTROL_APPROVAL_MIN',
  'C9VIEW_CONTROL_MAX_TURNS',
  'C9VIEW_CONTROL_MAX_BUDGET_USD',
  'C9VIEW_CONTROL_RECEIPT_MIN',
  'C9VIEW_CONTROL_TOMBSTONE_MAX',
  'C9VIEW_CONTROL_TEXT_MAX_CHARS',
  'C9VIEW_CLONE_TIMEOUT_MIN',
])('T005 rejects invalid %s with its name', (key) => {
  expect(() => loadControlConfig({ [key]: '-1' })).toThrow(key);
});
it('rejects bypass without control and malformed flags', () => {
  expect(() => loadControlConfig({ C9VIEW_CONTROL_BYPASS: '1' })).toThrow(
    'control',
  );
  expect(() => loadControlConfig({ C9VIEW_CONTROL: 'yes' })).toThrow(
    'C9VIEW_CONTROL',
  );
});

it('T015 refuses missing or unwritable directories without writing', async () => {
  const { assertWritableDirectory } = await import('./config.js');
  expect(() =>
    assertWritableDirectory(
      '/nonexistent/synthetic-project',
      'project directory',
    ),
  ).toThrow('writable project directory');
  expect(() =>
    assertWritableDirectory(
      '/nonexistent/synthetic-claude',
      'Claude data directory',
    ),
  ).toThrow('writable Claude data directory');
});
it('T015 refuses a missing explicitly selected executable', async () => {
  const { resolveClaudeBinary } = await import('./config.js');
  expect(() =>
    resolveClaudeBinary(
      loadControlConfig({ C9VIEW_CLAUDE_BIN: '/nonexistent/synthetic-claude' }),
      { PATH: '' },
    ),
  ).toThrow('C9VIEW_CLAUDE_BIN');
});

it('T015 access(W_OK) refusal does not probe with a write', async () => {
  const { assertWritableDirectory } = await import('./config.js');
  vi.mocked(accessSync).mockImplementationOnce(() => {
    throw new Error('EACCES');
  });
  expect(() => assertWritableDirectory('/tmp', 'project directory')).toThrow(
    'writable project directory',
  );
  vi.mocked(accessSync).mockImplementationOnce(() => {
    throw new Error('EACCES');
  });
  expect(() =>
    assertWritableDirectory('/tmp', 'Claude data directory'),
  ).toThrow('writable Claude data directory');
});
it('T005 parses all configurable limits and binary selection', () => {
  expect(
    loadControlConfig({
      C9VIEW_CONTROL: '1',
      C9VIEW_CONTROL_BYPASS: '1',
      C9VIEW_CLAUDE_BIN: '/synthetic/claude',
      C9VIEW_CONTROL_MAX_RUNS: '5',
      C9VIEW_CONTROL_MAX_TURNS: '7',
      C9VIEW_CONTROL_MAX_BUDGET_USD: '2.5',
      C9VIEW_WORKSPACE_ROOTS: '/tmp/a:/tmp/b',
      C9VIEW_CLONE_TIMEOUT_MIN: '4',
    }),
  ).toMatchObject({
    control: true,
    bypass: true,
    claudeBin: '/synthetic/claude',
    maxRuns: 5,
    maxTurns: 7,
    maxBudgetUsd: 2.5,
    workspaceRoots: ['/tmp/a', '/tmp/b'],
    cloneTimeoutMin: 4,
  });
});

import { describe, expect, it, vi } from 'vitest';
import { classifyStatus, processAlive, type LiveEntry } from './status.js';
const now = Date.parse('2026-10-25T01:00:00Z');
const live = (status = 'idle', extra: Partial<LiveEntry> = {}): LiveEntry => ({
  sessionId: 's',
  pid: 123,
  status,
  statusUpdatedAt: new Date(now).toISOString(),
  ...extra,
});
const options = { now, namespace: '42', alive: () => true };
describe('early kanban rules', () => {
  it('marks missing and dead processes inactive, even with pending tools', () => {
    expect(classifyStatus(undefined, 'Read', options)).toMatchObject({
      column: 'inactive',
      reason: 'no running process',
      source: 'none',
    });
    expect(
      classifyStatus(live('busy'), 'Read', { ...options, alive: () => false }),
    ).toMatchObject({ column: 'inactive', reason: 'no running process' });
    expect(
      classifyStatus(live('idle', { pid: undefined }), null, options).column,
    ).toBe('inactive');
  });
  it('gives explicit busy precedence over pending tools', () => {
    expect(
      classifyStatus(live('busy'), 'AskUserQuestion', options),
    ).toMatchObject({
      column: 'in_progress',
      source: 'live-status',
      stale: false,
    });
  });
  it.each(['Read', 'AskUserQuestion'])(
    'detects an unmatched %s tool',
    (tool) => {
      expect(classifyStatus(live(), tool, options)).toMatchObject({
        column: 'need_input',
        source: 'transcript',
        reason: `waiting on tool call: ${tool}`,
      });
    },
  );
  it('marks finished idle turns for review', () => {
    expect(classifyStatus(live(), null, options)).toMatchObject({
      column: 'in_review',
      reason: 'turn finished, waiting for you',
      observedAt: new Date(now).toISOString(),
    });
  });
  it.each([
    ['BUSY elsewhere', 'in_progress'],
    ['running', 'in_progress'],
    ['working', 'in_progress'],
    ['waiting', 'need_input'],
    ['input', 'need_input'],
    ['permission', 'need_input'],
    ['custom', 'in_review'],
  ])('maps raw status %s', (raw, column) => {
    expect(classifyStatus(live(raw), null, options)).toMatchObject({
      column,
      reason: `live status: ${raw}`,
    });
  });
  it('skips PID checks for foreign namespaces without marking fresh evidence stale', () => {
    const alive = vi.fn(() => false);
    expect(
      classifyStatus(live('busy', { pidDomain: 'pid:[99]' }), null, {
        ...options,
        alive,
      }),
    ).toMatchObject({ column: 'in_progress', stale: false });
    expect(alive).not.toHaveBeenCalled();
    classifyStatus(live('idle', { pidDomain: 42 }), null, {
      ...options,
      alive,
    });
    expect(alive).toHaveBeenCalledOnce();
  });
  it('marks busy entries older than ten minutes stale, with updatedAt fallback', () => {
    expect(
      classifyStatus(
        live('busy', { statusUpdatedAt: now - 600_001 }),
        null,
        options,
      ).stale,
    ).toBe(true);
    expect(
      classifyStatus(
        live('busy', { statusUpdatedAt: undefined, updatedAt: now - 600_001 }),
        null,
        options,
      ),
    ).toMatchObject({ stale: true, observedAt: null });
    expect(
      classifyStatus(
        live('busy', { statusUpdatedAt: now - 600_000 }),
        null,
        options,
      ).stale,
    ).toBe(false);
    expect(
      classifyStatus(
        live('idle', { statusUpdatedAt: now - 900_000 }),
        null,
        options,
      ).stale,
    ).toBe(false);
  });
  it('treats EPERM as alive and ESRCH as dead', () => {
    const kill = vi.spyOn(process, 'kill');
    try {
      kill.mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'EPERM' });
      });
      expect(processAlive(123)).toBe(true);
      kill.mockImplementation(() => {
        throw Object.assign(new Error(), { code: 'ESRCH' });
      });
      expect(processAlive(123)).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });
});

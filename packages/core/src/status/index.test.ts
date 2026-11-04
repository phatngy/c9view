import { describe, expect, it } from 'vitest';
import { decideStatus, type StatusInput } from './index.js';
import type { HookEvent } from '../hooks/events.js';
const now = Date.parse('2026-10-25T01:00:00Z');
const ts = (age = 0) => new Date(now - age).toISOString();
const event = (
  event: HookEvent['event'],
  age = 0,
  extra: Partial<HookEvent> = {},
): HookEvent => ({
  v: 1,
  ts: ts(age),
  event,
  sessionId: 's',
  cwd: '/tmp/project',
  ...extra,
});
const decide = (events: HookEvent[], extra: Partial<StatusInput> = {}) =>
  decideStatus({
    now,
    liveAlive: true,
    hookEvents: events,
    transcript: {},
    ...extra,
  });
describe('status fusion', () => {
  it.each([
    ['SessionEnd', 'inactive'],
    ['UserPromptSubmit', 'in_progress'],
    ['PreToolUse', 'in_progress'],
    ['PostToolUse', 'in_progress'],
    ['PostToolUseFailure', 'in_progress'],
    ['SubagentStop', 'in_progress'],
    ['SubagentStart', 'in_progress'],
    ['PostToolBatch', 'in_progress'],
    ['PermissionDenied', 'in_review'],
    ['StopFailure', 'in_review'],
    ['PermissionRequest', 'need_input'],
    ['Stop', 'in_review'],
  ] as const)('%s maps to %s', (name, column) =>
    expect(decide([event(name)])).toMatchObject({
      column,
      source: 'hook',
      confidence: 'high',
    }),
  );
  it.each(['permission_prompt', 'elicitation_dialog', 'agent_needs_input'])(
    'classifies %s',
    (notificationType) =>
      expect(
        decide([event('Notification', 0, { notificationType })]).column,
      ).toBe('need_input'),
  );
  it.each(['idle_prompt', 'waiting for input'])(
    'classifies %s',
    (notificationType) =>
      expect(
        decide([event('Notification', 0, { notificationType })]).column,
      ).toBe('in_review'),
  );
  it.each(['AskUserQuestion', 'ExitPlanMode'])(
    'waits for %s until a result',
    (toolName) => {
      expect(decide([event('PreToolUse', 1000, { toolName })]).column).toBe(
        'need_input',
      );
      expect(
        decide([
          event('PreToolUse', 1000, { toolName }),
          event('PostToolUse', 0, { toolName }),
        ]).column,
      ).toBe('in_progress');
    },
  );
  it('ignores non-status events and subagent Stop', () => {
    expect(
      decide([
        event('UserPromptSubmit', 1000),
        event('PreCompact'),
        event('Stop', 0, { subagent: true }),
      ]).column,
    ).toBe('in_progress');
  });
  it('lets newest signals win and prefers hooks within five seconds', () => {
    const live = { status: 'busy', statusUpdatedAt: ts() };
    expect(decide([event('Stop', 5000)], { live }).source).toBe('hook');
    expect(decide([event('Stop', 5001)], { live }).source).toBe('live-status');
    expect(
      decide([event('Stop')], { live: { ...live, statusUpdatedAt: ts(10000) } })
        .column,
    ).toBe('in_review');
    expect(
      decide([event('Stop', 10000)], {
        transcript: { lastAssistantPendingToolUse: { name: 'Read', at: ts() } },
      }).source,
    ).toBe('transcript');
  });
  it('detects a permission wait after three seconds on an idle process', () => {
    const live = { status: 'idle', statusUpdatedAt: ts() };
    expect(
      decide([event('PreToolUse', 3001, { toolName: 'Bash' })], { live }),
    ).toMatchObject({ column: 'need_input', source: 'hook', stale: false });
    expect(decide([event('PreToolUse', 3000)], { live }).column).toBe(
      'in_progress',
    );
    expect(
      decide([event('PreToolUse', 10000), event('PostToolUse')], { live })
        .column,
    ).toBe('in_progress');
  });
  it('handles dead processes, lag and SessionEnd', () => {
    expect(decide([event('Stop', 30001)], { liveAlive: false })).toMatchObject({
      column: 'inactive',
      reason: 'no running process',
    });
    expect(
      decide([event('PreToolUse', 1000)], { liveAlive: false }),
    ).toMatchObject({ column: 'in_progress', stale: true });
    expect(
      decide([event('SessionEnd', 60000)], { liveAlive: false }).column,
    ).toBe('inactive');
    expect(decide([event('SubagentStop')], { liveAlive: false }).column).toBe(
      'inactive',
    );
  });
  it('uses transcript pending tools, questions and end times', () => {
    expect(
      decide([], {
        transcript: { lastAssistantPendingToolUse: { name: 'Read', at: ts() } },
      }).column,
    ).toBe('need_input');
    expect(
      decide([], { transcript: { asksQuestion: true, lastAt: ts() } }).column,
    ).toBe('need_input');
    expect(decide([], { transcript: { endedTurnAt: ts() } }).column).toBe(
      'in_review',
    );
    expect(
      decide([], { liveAlive: false, transcript: { asksQuestion: true } })
        .column,
    ).toBe('inactive');
  });
  it('keeps assistant questions visible while idle and closes dead sessions after SessionEnd', () => {
    expect(
      decide([], {
        live: { status: 'idle', statusUpdatedAt: ts() },
        transcript: { asksQuestion: true, lastAt: ts(10000) },
      }).column,
    ).toBe('need_input');
    expect(
      decide([event('SessionEnd', 60000)], {
        liveAlive: false,
        live: { status: 'busy', statusUpdatedAt: ts() },
      }).column,
    ).toBe('inactive');
    expect(
      decide(
        [event('PreToolUse', 10000, { toolName: 'Bash' }), event('PreCompact')],
        { live: { status: 'idle', statusUpdatedAt: ts() } },
      ).column,
    ).toBe('need_input');
  });
  it('marks old active evidence and foreign PID namespaces stale', () => {
    expect(decide([event('PreToolUse', 600001)]).stale).toBe(true);
    expect(decide([event('PermissionRequest', 600001)]).stale).toBe(true);
    expect(decide([event('Stop', 600001)]).stale).toBe(false);
    expect(
      decide([], {
        live: { status: 'busy' },
        liveAlive: false,
        pidNamespaceMismatch: true,
      }),
    ).toMatchObject({ column: 'in_progress', stale: true, confidence: 'low' });
  });
});

it.each([
  [event('PreToolUse', 1000), 'idle', 'in_progress'],
  [
    event('PreToolUse', 1000, { toolName: 'AskUserQuestion' }),
    'busy',
    'need_input',
  ],
  [event('Stop', 5000), 'busy', 'in_review'],
  [event('SessionEnd'), 'busy', 'inactive'],
  [event('PreToolUse', 4000), 'idle', 'need_input'],
  [
    event('Notification', 1000, { notificationType: 'idle_prompt' }),
    'busy',
    'in_review',
  ],
] as const)(
  'fresh %s lowers confidence on disagreement without marking stale',
  (hook, status, column) => {
    const result = decide([hook], { live: { status, statusUpdatedAt: ts() } });
    expect(result).toMatchObject({
      column,
      stale: false,
      confidence: 'medium',
    });
    expect(result.evidence.some((e) => e.detail.includes('disagree'))).toBe(
      true,
    );
  },
);
it('uses main agent tool evidence and names turn-ending events', () => {
  expect(
    decide([event('PreToolUse', 0, { agentId: 'main-agent' })]).column,
  ).toBe('in_progress');
  expect(decide([event('SubagentStart', 0, { subagent: true })]).column).toBe(
    'in_progress',
  );
  for (const name of ['PermissionDenied', 'StopFailure'] as const)
    expect(decide([event(name)]).reason).toContain(name);
});

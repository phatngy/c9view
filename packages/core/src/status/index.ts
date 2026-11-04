import type { HookEvent } from '../hooks/events.js';
export interface LiveSessionFile {
  status?: string | undefined;
  statusUpdatedAt?: string | number | undefined;
  updatedAt?: string | number | undefined;
}
export type StatusColumn =
  'inactive' | 'in_progress' | 'need_input' | 'in_review';
export type StatusSource = 'hook' | 'live-status' | 'transcript' | 'none';
export interface StatusEvidence {
  source: StatusSource;
  at: string | null;
  detail: string;
}
export interface StatusDecision {
  column: StatusColumn;
  reason: string;
  source: StatusSource;
  observedAt: string | null;
  stale: boolean;
  confidence: 'high' | 'medium' | 'low';
  evidence: StatusEvidence[];
}
export interface StatusInput {
  now: number;
  live?: LiveSessionFile | undefined;
  liveAlive?: boolean | undefined;
  pidNamespaceMismatch?: boolean | undefined;
  hookEvents: HookEvent[];
  transcript: {
    lastAssistantPendingToolUse?:
      { name: string; at?: string | undefined } | undefined;
    lastAt?: string | undefined;
    endedTurnAt?: string | undefined;
    asksQuestion?: boolean | undefined;
  };
}
const timestamp = (value: string | number | undefined): string | null => {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
export function decideStatus(input: StatusInput): StatusDecision {
  const { now, live, transcript, hookEvents } = input;
  const evidence: StatusEvidence[] = [];
  type Candidate = {
    column: StatusColumn;
    reason: string;
    source: StatusSource;
    at: string | null;
  };
  const time = (candidate: Candidate) =>
    candidate.at ? Date.parse(candidate.at) : 0;
  let hook: Candidate | undefined;
  let hookEvent: HookEvent | undefined;
  const alive = input.liveAlive || input.pidNamespaceMismatch;
  for (const event of hookEvents) {
    if (
      event.subagent &&
      !['SubagentStart', 'SubagentStop'].includes(event.event)
    )
      continue;
    let column: StatusColumn | undefined;
    if (event.event === 'SessionEnd') column = 'inactive';
    else if (['Stop', 'StopFailure', 'PermissionDenied'].includes(event.event))
      column = 'in_review';
    else if (
      event.event === 'PermissionRequest' ||
      (event.event === 'Notification' &&
        /permission|elicitation_dialog|agent_needs_input/.test(
          event.notificationType ?? '',
        ))
    )
      column = 'need_input';
    else if (
      event.event === 'Notification' &&
      /idle|waiting/.test(event.notificationType ?? '')
    )
      column = 'in_review';
    else if (
      event.event === 'PreToolUse' &&
      ['AskUserQuestion', 'ExitPlanMode'].includes(event.toolName ?? '')
    )
      column = 'need_input';
    else if (
      [
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'PostToolBatch',
      ].includes(event.event) ||
      (['SubagentStart', 'SubagentStop'].includes(event.event) && alive)
    )
      column = 'in_progress';
    if (column) {
      const detail = `hook: ${event.event}${event.toolName ? ' ' + event.toolName : ''}${event.notificationType ? ' ' + event.notificationType : ''}`;
      hook = { column, reason: detail, source: 'hook', at: event.ts };
      hookEvent = event;
      evidence.push({ source: 'hook', at: event.ts, detail });
    }
  }
  const raw = live?.status ?? 'idle';
  const liveAt = timestamp(live?.statusUpdatedAt) ?? timestamp(live?.updatedAt);
  const liveCandidate: Candidate | undefined = live
    ? {
        column: /busy|running|working/i.test(raw)
          ? 'in_progress'
          : /wait|input|permission/i.test(raw)
            ? 'need_input'
            : 'in_review',
        reason:
          raw === 'idle'
            ? 'turn finished, waiting for you'
            : `live status: ${raw}`,
        source: 'live-status',
        at: liveAt,
      }
    : undefined;
  if (liveCandidate)
    evidence.push({
      source: 'live-status',
      at: liveAt,
      detail: `live status: ${raw}`,
    });
  const pending = transcript.lastAssistantPendingToolUse;
  const transcriptCandidate: Candidate | undefined =
    pending || transcript.asksQuestion || transcript.endedTurnAt
      ? {
          column:
            pending || transcript.asksQuestion ? 'need_input' : 'in_review',
          reason: pending
            ? `waiting on tool call: ${pending.name}`
            : transcript.asksQuestion
              ? 'transcript: question to the user'
              : 'transcript: turn finished',
          source: 'transcript',
          at: timestamp(
            pending?.at ?? transcript.endedTurnAt ?? transcript.lastAt,
          ),
        }
      : undefined;
  if (transcriptCandidate)
    evidence.push({
      source: 'transcript',
      at: transcriptCandidate.at,
      detail: transcriptCandidate.reason,
    });
  let chosen: Candidate = liveCandidate ??
    transcriptCandidate ?? {
      column: 'inactive',
      reason: 'no status signals',
      source: 'none',
      at: null,
    };
  if (
    transcriptCandidate &&
    (!liveCandidate ||
      time(transcriptCandidate) > time(liveCandidate) ||
      ((pending || transcript.asksQuestion) && raw === 'idle'))
  )
    chosen = transcriptCandidate;
  if (hook && time(hook) >= time(chosen) - 5000) chosen = hook;
  const last = hookEvents.filter((e) => !e.subagent).at(-1);
  if (
    alive &&
    live?.status === 'idle' &&
    hookEvent?.event === 'PreToolUse' &&
    now - Date.parse(hookEvent.ts) > 3000
  ) {
    chosen = {
      column: 'need_input',
      reason: `hook: PreToolUse ${hookEvent.toolName ?? 'tool'} · no result yet`,
      source: 'hook',
      at: hookEvent.ts,
    };
  }
  const recentHook = !!last && now - Date.parse(last.ts) < 30000;
  if (!alive && hook?.column === 'inactive') chosen = hook;
  else if (!alive && !recentHook)
    chosen = {
      column: 'inactive',
      reason: 'no running process',
      source: live ? 'live-status' : 'none',
      at: liveAt,
    };
  const disagree =
    !!hook && !!liveCandidate && hook.column !== liveCandidate.column;
  if (disagree)
    evidence.push({
      source: 'hook',
      at: hook!.at,
      detail: 'hook and live status disagree',
    });
  // A foreign PID namespace (e.g. Docker without --pid=host) only means liveness
  // can't be checked; it doesn't make fresh evidence stale. Hooks don't depend on
  // PIDs, and a crashed process leaves old evidence, caught by the 10-minute rule.
  const stale =
    (!alive && recentHook && chosen.column !== 'inactive') ||
    (['in_progress', 'need_input'].includes(chosen.column) &&
      now - time(chosen) > 600000);
  const age =
    chosen.source === 'hook' && chosen.at
      ? ` · ${Math.max(0, Math.floor((now - Date.parse(chosen.at)) / 1000))}s ago`
      : '';
  return {
    column: chosen.column,
    reason: chosen.reason + age,
    source: chosen.source,
    observedAt:
      chosen.source === 'live-status'
        ? timestamp(live?.statusUpdatedAt)
        : chosen.at,
    stale,
    confidence:
      stale || chosen.source === 'none'
        ? 'low'
        : chosen.source === 'hook' && !disagree
          ? 'high'
          : 'medium',
    evidence: evidence.slice(-200),
  };
}
export * from './transcript.js';

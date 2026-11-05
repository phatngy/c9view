import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type {
  KanbanColumn,
  RunState,
  RunSummary,
  SessionStatus,
} from '@c9view/api';
import { ConfirmDialog, IconButton, Menu } from '../kit/index.js';
import { labels, relative } from '../ui.js';
import { BypassBadge, DrivenBadge } from './cards.js';

/** Human text and a token colour for every run state. */
export const stateInfo: Record<
  RunState,
  { label: string; dot: string; pulse?: boolean }
> = {
  starting: { label: 'Starting…', dot: 'bg-in-progress', pulse: true },
  running: { label: 'Working…', dot: 'bg-in-progress', pulse: true },
  waiting: { label: 'Waiting for you', dot: 'bg-need-input' },
  idle: { label: 'Ready', dot: 'bg-success' },
  ended: { label: 'Ended', dot: 'bg-inactive' },
  failed: { label: 'Failed', dot: 'bg-danger' },
};
/** The session's own column, with the app's existing names, when no run. */
const columnDot: Record<KanbanColumn, string> = {
  inactive: 'bg-inactive',
  need_input: 'bg-need-input',
  in_progress: 'bg-in-progress',
  in_review: 'bg-in-review',
};
const announced = new Set([
  'Waiting for you',
  'Ended',
  'Failed',
  labels.need_input,
]);

export function RunBar({
  run,
  status,
  lastAt = null,
  needsInput = false,
  onStop,
  onStopped,
}: {
  /** The c9view run, if any. Without one the session's own status shows. */
  run?: RunSummary | undefined;
  status?: SessionStatus | undefined;
  lastAt?: string | null | undefined;
  /** A permission or question request is pending for this run. */
  needsInput?: boolean;
  onStop?: (() => Promise<void>) | undefined;
  /** Called once after a successful stop, when the dialog is fully closed. */
  onStopped?: (() => void) | undefined;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const section = useRef<HTMLElement>(null);
  const stopped = useRef(false);
  const dialogMounted = useRef(false);
  const [confirming, setConfirming] = useState(false);
  async function act(action: () => Promise<void>): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const ended = !!run && ['ended', 'failed'].includes(run.state);
  const info: { label: string; dot: string; pulse?: boolean } = run
    ? stateInfo[needsInput && !ended ? 'waiting' : run.state]
    : {
        label: labels[status?.column ?? 'inactive'],
        dot: columnDot[status?.column ?? 'inactive'],
      };
  const queued = run?.queued ?? 0;
  const label = `${info.label}${queued > 0 ? ` · ${queued} queued` : ''}`;
  // Re-render each minute so "last active" stays current; it is not announced.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (run) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [run]);
  // Announce only a change into a state that needs attention, once each.
  const previous = useRef(info.label);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (previous.current === info.label) return;
    previous.current = info.label;
    // The composer already announces pending requests.
    const skip = needsInput && info.label === stateInfo.waiting.label;
    setAnnouncement(announced.has(info.label) && !skip ? info.label : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.label]);
  const lastActive = lastAt ? `last active ${relative(lastAt)}` : 'No activity';
  return (
    <section
      ref={section}
      aria-label={run ? 'Run controls' : 'Session status'}
      className="flex-none text-xs text-muted"
    >
      <div className="flex min-h-11 flex-nowrap items-center gap-2 px-2 lg:min-h-9">
        <span
          aria-hidden="true"
          data-testid="run-dot"
          className={`size-2 shrink-0 rounded-full ${info.dot} ${info.pulse ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        />
        <span
          title={run ? label : `${label} · ${lastActive}`}
          className="flex min-w-0 items-baseline gap-1 font-medium text-ink"
        >
          <span className={run ? 'truncate' : 'shrink-0'}>{info.label}</span>
          {queued > 0 && <span className="shrink-0">· {queued} queued</span>}
          {!run && (
            <span
              data-testid="last-active"
              className="min-w-0 truncate font-normal text-muted"
            >
              · {lastActive}
            </span>
          )}
        </span>
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
        {run && (
          <span
            data-testid="run-badges"
            className="flex min-w-0 gap-1.5 max-sm:hidden"
          >
            <DrivenBadge compact />
            {run.mode === 'bypassPermissions' && <BypassBadge compact />}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {run && !ended && onStop && (
            <Menu
              trigger={
                <IconButton
                  label="Run options"
                  icon={MoreHorizontal}
                  size="sm"
                  disabled={pending}
                />
              }
              items={[
                {
                  label: 'Stop',
                  destructive: true,
                  disabled: pending,
                  onSelect: () => {
                    stopped.current = false;
                    dialogMounted.current = true;
                    setConfirming(true);
                  },
                },
              ]}
            />
          )}
          {onStop && (
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="Stop this run?"
              description="Claude stops working on this session and the run ends. Reply later to start it again."
              confirmLabel="Stop"
              destructive
              pending={pending}
              onClosed={() => {
                dialogMounted.current = false;
                if (stopped.current) onStopped?.();
              }}
              onConfirm={() =>
                void act(onStop).then((ok) => {
                  stopped.current = ok;
                  setConfirming(false);
                  if (ok && !dialogMounted.current) onStopped?.();
                })
              }
              finalFocus={() =>
                // After a successful stop the composer takes focus (onStopped);
                // otherwise focus returns to the trigger.
                stopped.current
                  ? false
                  : (section.current?.querySelector<HTMLElement>(
                      '[aria-label="Run options"]',
                    ) ?? null)
              }
            />
          )}
        </span>
      </div>
      {(error || run?.error) && (
        <p role="alert" className="px-2 text-danger">
          {error || run?.error}
        </p>
      )}
    </section>
  );
}

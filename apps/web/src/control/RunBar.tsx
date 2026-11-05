import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { RunState, RunSummary } from '@c9view/api';
import { Button, IconButton, Menu } from '../kit/index.js';
import { money } from '../ui.js';
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
const announced = new Set(['Waiting for you', 'Ended', 'Failed']);

export function RunBar({
  run,
  needsInput = false,
  onInterrupt,
  onStop,
}: {
  run: RunSummary;
  /** A permission or question request is pending for this run. */
  needsInput?: boolean;
  onInterrupt: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function act(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const ended = ['ended', 'failed'].includes(run.state);
  const working = ['starting', 'running'].includes(run.state);
  const info = stateInfo[needsInput && !ended ? 'waiting' : run.state];
  const label = `${info.label}${run.queued > 0 ? ` · ${run.queued} queued` : ''}`;
  // Announce only a change into a state that needs attention, once each.
  const previous = useRef(info.label);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (previous.current === info.label) return;
    previous.current = info.label;
    setAnnouncement(announced.has(info.label) ? info.label : '');
  }, [info.label]);
  return (
    <section aria-label="Run controls" className="flex-none text-xs text-muted">
      <div className="flex min-h-11 flex-nowrap items-center gap-2 px-2 lg:min-h-9">
        <span
          aria-hidden="true"
          data-testid="run-dot"
          className={`size-2 shrink-0 rounded-full ${info.dot} ${info.pulse ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        />
        <span
          title={label}
          className="flex min-w-0 items-baseline gap-1 font-medium text-ink"
        >
          <span className="truncate">{info.label}</span>
          {run.queued > 0 && (
            <span className="shrink-0">· {run.queued} queued</span>
          )}
        </span>
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
        <span
          data-testid="run-badges"
          className="flex min-w-0 gap-1.5 max-sm:hidden"
        >
          <DrivenBadge compact />
          {run.mode === 'bypassPermissions' && <BypassBadge compact />}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {run.costUsd !== undefined && (
            <a
              className="inline-flex min-h-11 items-center px-1 underline decoration-dotted lg:min-h-9"
              href="#api-equivalent-cost"
              title="API-equivalent cost estimate"
              aria-label={`About ${money(run.costUsd)}, API-equivalent cost`}
            >
              {money(run.costUsd)}
            </a>
          )}
          {working && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => void act(onInterrupt)}
            >
              Interrupt
            </Button>
          )}
          {!ended && (
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
                  label: 'Stop run',
                  disabled: pending,
                  onSelect: () => void act(onStop),
                },
              ]}
            />
          )}
        </span>
      </div>
      {(error || run.error) && (
        <p role="alert" className="px-2 text-danger">
          {error || run.error}
        </p>
      )}
    </section>
  );
}

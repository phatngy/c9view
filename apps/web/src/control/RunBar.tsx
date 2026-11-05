import { useRef, useState } from 'react';
import type { RunSummary } from '@c9view/api';
import { Button } from '../kit/index.js';
import { money } from '../ui.js';
import { BypassBadge, DrivenBadge } from './cards.js';

export function RunBar({
  run,
  onInterrupt,
  onStop,
}: {
  run: RunSummary;
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
  return (
    <section
      aria-label="Run controls"
      className="flex flex-none flex-wrap items-center gap-2 border-b border-line bg-raised p-3 text-sm"
    >
      <span role="status">
        {run.state}
        {run.queued > 0 ? ` · ${run.queued} queued` : ''}
      </span>
      <DrivenBadge compact />
      {run.mode === 'bypassPermissions' && <BypassBadge compact />}
      {run.costUsd !== undefined && (
        <a
          className="min-h-11 content-center underline lg:min-h-9"
          href="#api-equivalent-cost"
        >
          ≈ API-equivalent {money(run.costUsd)}
        </a>
      )}
      <Button disabled={pending || ended} onClick={() => void act(onInterrupt)}>
        Interrupt
      </Button>
      <Button disabled={pending || ended} onClick={() => void act(onStop)}>
        Stop
      </Button>
      {(error || run.error) && (
        <p role="alert" className="w-full text-danger">
          {error || run.error}
        </p>
      )}
    </section>
  );
}

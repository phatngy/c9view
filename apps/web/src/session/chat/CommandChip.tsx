import { Terminal } from 'lucide-react';
import { shortTime } from './time.js';
export function CommandChip({
  name,
  args,
  timestamp,
}: {
  name: string;
  args: string;
  timestamp: string | null;
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="inline-flex min-h-[30px] items-center gap-2 rounded-full bg-accent-soft px-3 text-small text-accent">
        <Terminal aria-hidden="true" size={14} />
        <span className="font-mono text-small">{name}</span>
        {args && (
          <span className="font-mono text-small text-muted">{args}</span>
        )}
      </div>
      {timestamp && (
        <time className="text-xs text-muted" dateTime={timestamp}>
          {shortTime(timestamp)}
        </time>
      )}
    </div>
  );
}

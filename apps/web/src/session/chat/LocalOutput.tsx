import { useId, useState } from 'react';
import { shortTime } from './time.js';
export function LocalOutput({
  text,
  lines,
  timestamp,
}: {
  text: string;
  lines: number;
  timestamp: string | null;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5 text-xs text-muted">
      <div>
        {text.split('\n')[0]}
        {timestamp && (
          <>
            {' '}
            · <time dateTime={timestamp}>{shortTime(timestamp)}</time>
          </>
        )}
      </div>
      {lines > 1 && (
        <>
          <button
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
            className="rounded px-2 py-1 max-sm:min-h-11"
          >
            Show output ({lines} lines)
          </button>
          {open && (
            <pre
              id={id}
              className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap font-mono text-small"
            >
              {text}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

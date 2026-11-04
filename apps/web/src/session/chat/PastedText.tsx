import { useEffect, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
export function PastedText({
  text,
  lines,
  reveal = false,
}: {
  text: string;
  lines: number;
  reveal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    // A search jump reveals the fold; the user can still close it afterwards.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (reveal) setOpen(true);
  }, [reveal]);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-bubble-line bg-bubble-raised px-2.5 text-left text-small max-sm:min-h-11"
      >
        <ChevronRight
          aria-hidden="true"
          size={14}
          className={`${open ? 'rotate-90' : ''} motion-safe:transition-transform`}
        />
        <span className="flex-1">Pasted text</span>{' '}
        <span className="text-muted">{lines} lines</span>
      </button>
      {open && (
        <pre
          id={id}
          className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-small"
        >
          {text}
        </pre>
      )}
    </div>
  );
}

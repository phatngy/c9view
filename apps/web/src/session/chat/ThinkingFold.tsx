import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Markdown } from '../../markdown.js';
import { number } from '../../ui.js';
import { duration } from './time.js';
const explanation =
  'Approximate: time from the previous message to the end of thinking';
export function ThinkingFold({
  text,
  milliseconds,
  tokens = 0,
}: {
  text: string;
  milliseconds?: number | undefined;
  tokens?: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = (
    <>
      {milliseconds === undefined
        ? 'Thinking'
        : `Thought for ${duration(milliseconds)}`}
      {tokens > 0 && (
        <span className="text-muted"> · {number(tokens)} tokens</span>
      )}
    </>
  );
  if (!text.trim())
    return (
      <div title={explanation} className="text-small text-muted">
        {label}
      </div>
    );
  return (
    <div>
      <button
        title={explanation}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex h-[30px] items-center gap-2 rounded-lg border-0 bg-raised px-2.5 py-0 text-small text-muted max-sm:min-h-11"
      >
        <ChevronRight
          aria-hidden="true"
          size={14}
          className={`${open ? 'rotate-90' : ''} motion-safe:transition-transform`}
        />
        {label}
      </button>
      {open && (
        <div id={id} className="mt-2 text-muted">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

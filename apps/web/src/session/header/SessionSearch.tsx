import { useEffect, useRef } from 'react';
import { Button } from '../../kit/Button.js';
export interface SessionSearchProps {
  search: string;
  change: (value: string) => void;
  matches: number;
  selected: number | null;
  disabled: boolean;
  previous: () => void;
  next: () => void;
  projectId: string;
  close: () => void;
}
export function SessionSearch({
  search,
  change,
  matches,
  selected,
  disabled,
  previous,
  next,
  projectId,
  close,
}: SessionSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div
      id="session-search"
      className="flex flex-none flex-wrap items-center gap-3 py-3"
    >
      <input
        ref={input}
        type="search"
        aria-label="Search loaded messages"
        className="h-10 rounded-md border border-line bg-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent max-sm:min-h-11"
        value={search}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !search) {
            change('');
            close();
          }
        }}
      />
      <span role="status" className="text-xs text-muted">
        {matches} matches{selected !== null ? ` · ${selected} selected` : ''}
      </span>
      <Button disabled={disabled} onClick={previous}>
        Previous match
      </Button>
      <Button disabled={disabled} onClick={next}>
        Next match
      </Button>
      <a
        className="inline-flex h-10 items-center text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent max-sm:min-h-11"
        href={`/search?${new URLSearchParams({ q: search, projectId })}`}
      >
        Search all conversations
      </a>
    </div>
  );
}

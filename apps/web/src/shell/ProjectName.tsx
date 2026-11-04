import type { ReactNode } from 'react';
import type { ProjectNameHint } from '../projectNames.js';

/** Shared truncation keeps a colliding project's ordinal visible. */
export function ProjectName({
  name,
  id,
  hint,
  compact = false,
}: {
  compact?: boolean;
  name: ReactNode;
  id: string;
  hint?: ProjectNameHint | undefined;
}) {
  return (
    <span
      className="inline-flex min-w-0 flex-1 items-baseline gap-1.5"
      title={id}
    >
      <span
        className={`shell-truncate shrink-0 truncate${compact ? ' max-w-[70%]' : ''}`}
      >
        {name}
      </span>
      {hint && (
        <span
          className="flex min-w-0 items-baseline text-xs font-normal text-muted"
          title={id}
        >
          <span className="min-w-0 truncate text-muted" title={id}>
            {hint.path}
          </span>
          {hint.ordinal && <span className="shrink-0"> #{hint.ordinal}</span>}
        </span>
      )}
    </span>
  );
}

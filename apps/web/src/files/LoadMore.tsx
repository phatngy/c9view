import { useEffect, useRef } from 'react';
import { Button } from '../kit/index.js';

export function LoadMore({
  query,
  label,
}: {
  label: string;
  query: {
    hasNextPage: boolean;
    isFetching: boolean;
    error: unknown;
    data: unknown;
    fetchNextPage: () => unknown;
  };
}) {
  const focusTarget = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!query.hasNextPage && focusTarget.current) {
      // Only restore focus lost with the removed button; respect navigation away.
      if (document.activeElement === document.body) focusTarget.current.focus();
      focusTarget.current = null;
    }
  }, [query.hasNextPage]);
  if (!query.hasNextPage) return null;
  const failed = !!query.error && !!query.data;
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-muted">
      {failed ? (
        <p role="alert">Could not load more {label}. Try again.</p>
      ) : (
        <p role="note">More {label} are available.</p>
      )}
      <Button
        size="sm"
        className="max-lg:min-h-11 max-lg:min-w-11"
        disabled={query.isFetching}
        aria-label={`${failed ? 'Retry loading' : 'Load more'} ${label}`}
        onClick={(event) => {
          focusTarget.current =
            document.activeElement === event.currentTarget
              ? event.currentTarget.closest<HTMLElement>('[data-page-list]')
              : null;
          void query.fetchNextPage();
        }}
      >
        {failed ? 'Retry' : 'Load more'}
      </Button>
    </div>
  );
}

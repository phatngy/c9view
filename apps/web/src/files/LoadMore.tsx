import { Button } from '../kit/index.js';

export function LoadMore({
  query,
}: {
  query: {
    hasNextPage: boolean;
    isFetching: boolean;
    fetchNextPage: () => unknown;
  };
}) {
  if (!query.hasNextPage) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-muted">
      <p role="note">More items are available.</p>
      <Button
        size="sm"
        className="max-lg:min-h-11 max-lg:min-w-11"
        disabled={query.isFetching}
        onClick={() => {
          void query.fetchNextPage();
        }}
      >
        Load more
      </Button>
    </div>
  );
}

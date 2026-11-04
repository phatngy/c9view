export interface ConversationEdgeState {
  hasEarlier: boolean;
  loading: boolean;
  error: boolean;
  load: () => void;
}

export function ConversationEdge({
  hasEarlier,
  loading,
  error,
  load,
}: ConversationEdgeState) {
  return (
    <div className="flex h-8 flex-none items-center justify-center gap-2 whitespace-nowrap text-xs text-muted max-lg:h-11">
      <div role="status">
        {error && !loading ? null : hasEarlier || loading ? (
          <button
            className="max-lg:min-h-11 focus-visible:outline-2 focus-visible:outline-accent"
            aria-disabled={loading || undefined}
            onClick={() => {
              if (!loading) load();
            }}
          >
            {loading ? 'Loading earlier messages…' : 'Load earlier messages'}
          </button>
        ) : (
          'Beginning of session'
        )}
      </div>
      {error && !loading && (
        <div role="alert">
          Couldn't load earlier messages.{' '}
          <button
            className="underline max-lg:min-h-11 focus-visible:outline-2 focus-visible:outline-accent"
            onClick={load}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

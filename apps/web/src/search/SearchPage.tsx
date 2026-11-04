import { useBreadcrumbs } from '../shell/breadcrumbs.js';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';
import {
  api,
  HttpError,
  useGlobalSearch,
  useHealth,
  useOverview,
  useProjects,
  type SearchFilters,
} from '../api.js';
import { Empty, Failure, Loading, relative } from '../ui.js';
import { Select, Skeleton } from '../kit/index.js';
import { Highlights } from './highlights.js';
import { cleanSnippet } from './snippet.js';

export function SearchPage() {
  useBreadcrumbs([{ label: 'Search' }]);
  const filters = useSearch({ from: '/search' });
  const navigate = useNavigate({ from: '/search' });
  const [draft, setDraft] = useState(filters.q);
  const [lastPushedQuery, setLastPushedQuery] = useState<string | undefined>();
  const [previousQuery, setPreviousQuery] = useState(filters.q);
  if (previousQuery !== filters.q) {
    setPreviousQuery(filters.q);
    if (filters.q !== lastPushedQuery) setDraft(filters.q);
    else setLastPushedQuery(undefined);
  }
  useEffect(() => {
    if (draft === filters.q) return;
    const timer = setTimeout(() => {
      setLastPushedQuery(draft);
      void navigate({ search: { ...filters, q: draft }, replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, filters, navigate]);
  const update = (key: keyof SearchFilters, value: string) => {
    if (draft !== filters.q) setLastPushedQuery(draft);
    void navigate({ search: { ...filters, q: draft, [key]: value } });
  };
  const projects = useProjects();
  const overview = useOverview();
  const results = useGlobalSearch(filters);
  const unavailable =
    results.error instanceof HttpError && results.error.status === 503;
  const health = useHealth(unavailable);
  const rows = results.data?.pages.flatMap((page) => page.results) ?? [];
  const projectOptions =
    projects.data?.projects.map((project) => ({
      value: project.id,
      label: project.name,
    })) ?? [];
  if (
    filters.projectId &&
    !projectOptions.some(({ value }) => value === filters.projectId)
  ) {
    projectOptions.push({
      value: filters.projectId,
      label: 'Selected project',
    });
  }
  const modelOptions =
    overview.data?.byModel.map(({ model }) => ({
      value: model,
      label: model,
    })) ?? [];
  if (
    filters.model &&
    !modelOptions.some(({ value }) => value === filters.model)
  ) {
    modelOptions.push({ value: filters.model, label: 'Selected model' });
  }
  const ids = [...new Set(rows.map((row) => row.projectId))];
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['project', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.project(id, signal),
    })),
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = JSON.stringify([row.projectId, row.sessionId]);
    const group = groups.get(key) ?? [];
    if (!group.some((item) => item.messageUuid === row.messageUuid))
      group.push(row);
    groups.set(key, group);
  }
  return (
    <div className="search-page min-w-0 space-y-5">
      <h1>Search conversations</h1>
      <form
        className="search-filters panel flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          update('q', draft);
        }}
      >
        <label>
          Query
          <input
            type="search"
            aria-label="Search query"
            value={draft}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="search-filter">
          <span id="search-project-label">Project</span>
          <Select
            label="Project"
            labelledBy="search-project-label"
            value={filters.projectId || 'all'}
            onValueChange={(value) =>
              update('projectId', value === 'all' ? '' : value)
            }
            options={[
              { value: 'all', label: 'All projects' },
              ...projectOptions,
            ]}
          />
        </div>
        <label>
          From
          <input
            type="date"
            aria-label="From"
            value={filters.from}
            onChange={(event) => update('from', event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            aria-label="To"
            value={filters.to}
            onChange={(event) => update('to', event.target.value)}
          />
        </label>
        <div className="search-filter">
          <span id="search-model-label">Model</span>
          <Select
            label="Model"
            labelledBy="search-model-label"
            value={filters.model || 'all'}
            onValueChange={(value) =>
              update('model', value === 'all' ? '' : value)
            }
            options={[{ value: 'all', label: 'All models' }, ...modelOptions]}
          />
        </div>
        <button type="submit">Search</button>
      </form>
      {!filters.q.trim() ? (
        <Empty>Enter a query to search conversations.</Empty>
      ) : unavailable ? (
        <div role="status" className="panel">
          Search is available once indexing finishes
          {health.data?.index?.progress && (
            <p>
              Indexed {health.data.index.progress.completed} of{' '}
              {health.data.index.progress.total}
            </p>
          )}
          <button
            onClick={() => {
              void health.refetch();
              void results.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : results.error ? (
        <Failure error={results.error} retry={results.refetch} />
      ) : results.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>No results match your search.</Empty>
      ) : (
        <>
          {[...groups.entries()].map(([key, group]) => {
            const first = group[0]!;
            const project = projects.data?.projects.find(
              (project) => project.id === first.projectId,
            );
            const session = details[
              ids.indexOf(first.projectId)
            ]?.data?.sessions.find((session) => session.id === first.sessionId);
            return (
              <section className="panel" key={key}>
                <h2>
                  {project?.name ?? first.projectId} ·{' '}
                  {session?.title || 'Untitled session'} · {group.length}{' '}
                  {group.length === 1 ? 'hit' : 'hits'}
                </h2>
                {group.map((row) => {
                  const cleaned = cleanSnippet(row);
                  return (
                    <Link
                      className="block min-h-11 border-t border-line py-3 hover:bg-surface focus-visible:outline-offset-2"
                      key={row.messageUuid}
                      to="/projects/$projectId/sessions/$sessionId"
                      params={{
                        projectId: row.projectId,
                        sessionId: row.sessionId,
                      }}
                      hash={`m-${row.messageUuid}`}
                    >
                      <p className="text-xs text-muted">
                        {row.role ?? 'Unknown role'}
                        {row.model ? ` · ${row.model}` : ''} ·{' '}
                        {relative(row.timestamp)}
                      </p>
                      {cleaned.snippet.replaceAll('…', '').trim() && (
                        <p className="mt-2 whitespace-pre-wrap break-words">
                          <Highlights
                            text={cleaned.snippet}
                            ranges={cleaned.highlights}
                          />
                        </p>
                      )}
                    </Link>
                  );
                })}
              </section>
            );
          })}
          {results.hasNextPage && (
            <button
              disabled={results.isFetchingNextPage}
              onClick={() => void results.fetchNextPage()}
            >
              {results.isFetchingNextPage ? (
                <>
                  <Skeleton className="h-4 w-20" />
                  <span className="sr-only">Loading…</span>
                </>
              ) : (
                'Load more'
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}

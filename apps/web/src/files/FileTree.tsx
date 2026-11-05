import { queryKeys } from '../queryKeys.js';
import { useMachineId } from '../machine.js';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { GitStatusResponse, ProjectFileEntry } from '@c9view/api';
import { api } from '../api.js';
import { EmptyState, Skeleton } from '../kit/index.js';
import { LoadMore } from './LoadMore.js';
import { useCursorList } from './paging.js';
import { FileFailure } from './shared.js';

function saved(projectId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(`c9view-tree-${projectId}`) ?? '[]',
    );
    return new Set(
      Array.isArray(value)
        ? value.filter((path): path is string => typeof path === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}
const statusBadge = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
};
export function FileTree({
  projectId,
  onOpen,
  status,
}: {
  projectId: string;
  onOpen: (entry: ProjectFileEntry) => void;
  status?: GitStatusResponse | undefined;
}) {
  const [expanded, setExpanded] = useState(() => saved(projectId));
  const root = useRef<HTMLDivElement>(null);
  const badges = new Map(
    status?.isRepo
      ? status.files.map((file) => [file.path, statusBadge[file.status]])
      : [],
  );
  function toggle(path: string, open?: boolean) {
    setExpanded((old) => {
      const next = new Set(old);
      if (open ?? !next.has(path)) next.add(path);
      else next.delete(path);
      try {
        sessionStorage.setItem(
          `c9view-tree-${projectId}`,
          JSON.stringify([...next]),
        );
      } catch {
        /* Optional storage. */
      }
      return next;
    });
  }
  function navigate(event: KeyboardEvent) {
    const items = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-tree-entry]',
      ) ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      const target =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : Math.max(
                0,
                Math.min(
                  items.length - 1,
                  index + (event.key === 'ArrowDown' ? 1 : -1),
                ),
              );
      items[target]?.focus();
    }
  }
  return (
    <div
      ref={root}
      onKeyDown={navigate}
      aria-label="Project files"
      className="min-w-0"
    >
      <Directory
        path=""
        projectId={projectId}
        expanded={expanded}
        toggle={toggle}
        onOpen={onOpen}
        badges={badges}
      />
    </div>
  );
}
function Directory({
  path,
  projectId,
  expanded,
  toggle,
  onOpen,
  badges,
}: {
  path: string;
  projectId: string;
  expanded: Set<string>;
  toggle: (path: string, open?: boolean) => void;
  onOpen: (entry: ProjectFileEntry) => void;
  badges: Map<string, string>;
}) {
  const machineId = useMachineId();
  const query = useCursorList(
    queryKeys.files(machineId, projectId, path),
    (signal, cursor) => api.files(machineId, projectId, path, signal, cursor),
    (pages) => ({
      ...pages[0]!,
      entries: pages.flatMap((page) => page.entries),
    }),
  );
  const [reason, setReason] = useState<string>();
  if (query.error && !query.data)
    return <FileFailure error={query.error} retry={query.refetch} />;
  return (
    <ul
      data-page-list
      tabIndex={-1}
      className={path ? 'ml-3 border-l border-line pl-2' : ''}
      aria-label={path || 'Root folder'}
    >
      {!query.data && (
        <li
          role="status"
          aria-label="Loading folder"
          className="space-y-2 py-2"
        >
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-1/2" />
          <span className="sr-only">Loading folder…</span>
        </li>
      )}
      {query.data?.entries.map((entry) => {
        const locked = entry.denied || entry.outside,
          open = expanded.has(entry.path),
          dir = entry.type === 'dir';
        const why =
          entry.reason ??
          (entry.outside ? 'Symlink outside the project' : 'Access denied');
        return (
          <li key={entry.path} className="min-w-0">
            <button
              data-tree-entry
              className={`tree-entry ${locked || entry.ignored ? 'text-muted opacity-65' : ''}`}
              aria-expanded={dir && !locked ? open : undefined}
              aria-describedby={
                locked && reason === entry.path
                  ? `reason-${encodeURIComponent(entry.path)}`
                  : undefined
              }
              title={locked ? why : undefined}
              onFocus={() => {
                if (locked) setReason(entry.path);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' && dir && !locked) {
                  event.preventDefault();
                  if (!open) toggle(entry.path, true);
                  else {
                    const child =
                      event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                        'ul button',
                      );
                    child?.focus();
                  }
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  if (dir && open) toggle(entry.path, false);
                  else
                    event.currentTarget
                      .closest('ul')
                      ?.parentElement?.querySelector<HTMLButtonElement>(
                        ':scope > button',
                      )
                      ?.focus();
                }
              }}
              onClick={() => {
                if (locked)
                  setReason(reason === entry.path ? undefined : entry.path);
                else if (dir) toggle(entry.path);
                else onOpen(entry);
              }}
            >
              <span aria-hidden="true">
                {locked
                  ? '🔒'
                  : dir
                    ? open
                      ? '▾'
                      : '▸'
                    : entry.type === 'symlink'
                      ? '↗'
                      : '·'}
              </span>{' '}
              <span className="break-all">{entry.name}</span>
              {entry.outside && <span className="badge">outside</span>}
              {badges.has(entry.path) && (
                <span className="badge">{badges.get(entry.path)}</span>
              )}
            </button>
            {locked && reason === entry.path && (
              <p
                role="note"
                id={`reason-${encodeURIComponent(entry.path)}`}
                className="px-2 text-xs text-muted"
              >
                {why}
              </p>
            )}
            {dir && open && !locked && (
              <Directory
                {...{ projectId, expanded, toggle, onOpen, badges }}
                path={entry.path}
              />
            )}
          </li>
        );
      })}
      <li hidden={!query.hasNextPage}>
        <LoadMore query={query} label="files in this folder" />
      </li>
      {query.data?.entries.length === 0 && (
        <li>
          <EmptyState compact title="Empty folder" />
        </li>
      )}
    </ul>
  );
}

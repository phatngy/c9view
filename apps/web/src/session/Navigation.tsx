import { queryKeys } from '../queryKeys.js';
import { useMachineId } from '../machine.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Message } from '@c9view/api';
import { EmptyState, Skeleton } from '../kit/index.js';
import { ColumnChip } from '../ui.js';
import { statusHistory } from './api.js';
import { outlineEntries } from './model.js';
export function Outline({
  messages,
  jump,
  hasEarlier = false,
  loadingEarlier = false,
  loadEarlier,
}: {
  messages: Message[];
  jump: (id: string) => void;
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  loadEarlier?: () => void;
}) {
  const [current, setCurrent] = useState<string>();
  const jumping = useRef(false);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    const finish = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.matches('.conversation-window')
      ) {
        jumping.current = false;
        clearTimeout(jumpTimer.current);
      }
    };
    document.addEventListener('scrollend', finish, true);
    return () => {
      document.removeEventListener('scrollend', finish, true);
      clearTimeout(jumpTimer.current);
    };
  }, []);
  const entries = useMemo(() => outlineEntries(messages), [messages]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    let cleanupRoot: (() => void) | undefined;
    const connect = () => {
      const root = document.querySelector('.conversation-window');
      if (!root || cleanupRoot) return;
      const visible = new Set<Element>();
      const observed = new Set<Element>();
      const order = new Map(
        messages.map((message, index) => [message.uuid, index]),
      );
      const observer = new IntersectionObserver(
        (changes) => {
          for (const change of changes) {
            if (change.isIntersecting) visible.add(change.target);
            else visible.delete(change.target);
          }
          if (jumping.current) return;
          const first = [...visible]
            .filter((node) => node.isConnected)
            .map((node) => order.get((node as HTMLElement).dataset.messageRow!))
            .filter((index): index is number => index !== undefined)
            .sort((a, b) => a - b)[0];
          if (first === undefined) return;
          const entry = entries.findLast(
            (entry) => (order.get(entry.id) ?? Infinity) <= first,
          );
          if (entry) setCurrent(entry.id);
        },
        { root, threshold: 0 },
      );
      const observeRows = () => {
        for (const node of observed) {
          if (!root.contains(node)) {
            observer.unobserve(node);
            observed.delete(node);
            visible.delete(node);
          }
        }
        root.querySelectorAll(':scope > [data-message-row]').forEach((node) => {
          if (!observed.has(node)) {
            observed.add(node);
            observer.observe(node);
          }
        });
      };
      observeRows();
      const mutations = new MutationObserver(observeRows);
      mutations.observe(root, { childList: true });
      cleanupRoot = () => {
        mutations.disconnect();
        observer.disconnect();
      };
    };
    connect();
    // The outline can mount before the conversation finishes loading.
    const mounting = new MutationObserver(() => {
      connect();
      if (cleanupRoot) mounting.disconnect();
    });
    if (!cleanupRoot)
      mounting.observe(document.body, { childList: true, subtree: true });
    return () => {
      mounting.disconnect();
      cleanupRoot?.();
    };
  }, [messages, entries]);
  const markers = { command: '/', prompt: '›', plan: '◆', question: '?' };
  const colors = {
    command: 'text-accent',
    prompt: 'text-muted',
    plan: 'text-in-review',
    question: 'text-need-input',
  };
  return (
    <section className="panel">
      <h2>Outline</h2>
      {hasEarlier && (
        <div className="mb-3 text-xs text-muted">
          <p>Earlier prompts aren't loaded yet.</p>
          <button
            className="min-h-8 underline max-lg:min-h-11 focus-visible:outline-2 focus-visible:outline-accent"
            aria-disabled={loadingEarlier || undefined}
            onClick={() => {
              if (!loadingEarlier) loadEarlier?.();
            }}
          >
            {loadingEarlier
              ? 'Loading earlier messages…'
              : 'Load earlier messages'}
          </button>
        </div>
      )}
      <ol className="prompt-outline">
        {entries.map((entry, i) => (
          <li key={`${entry.id}-${i}`}>
            <button
              className={`max-lg:min-h-11 focus-visible:outline-2 focus-visible:outline-accent ${entry.kind === 'question' ? 'text-need-input' : ''}`}
              aria-current={current === entry.id ? 'true' : undefined}
              onClick={() => {
                jumping.current = true;
                clearTimeout(jumpTimer.current);
                jumpTimer.current = setTimeout(() => {
                  jumping.current = false;
                }, 600);
                setCurrent(entry.id);
                jump(entry.id);
              }}
            >
              <span aria-hidden="true" className={colors[entry.kind]}>
                {markers[entry.kind]}
              </span>
              <span className="sr-only">
                {entry.kind[0]!.toUpperCase() + entry.kind.slice(1)}:{' '}
              </span>{' '}
              <span className="outline-label" title={entry.label}>
                {entry.label}
              </span>
              {entry.time && (
                <time className="text-xs!" dateTime={entry.time}>
                  {new Date(entry.time).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              )}
            </button>
          </li>
        ))}
      </ol>
      {!entries.length && (
        <EmptyState compact title="No outline entries loaded." />
      )}
    </section>
  );
}

export function Timeline({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const machineId = useMachineId();
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.statusHistory(machineId, projectId, sessionId),
    queryFn: ({ signal }) =>
      statusHistory(machineId, projectId, sessionId, signal),
    refetchInterval: 5000,
  });
  const changes = query.data?.changes ?? [];
  return (
    <section className="panel">
      <h2>Status timeline</h2>
      {query.error ? (
        <p role="status">
          Status history unavailable.{' '}
          <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : (
        <ol className="status-timeline" id="session-status-changes">
          {(all ? changes : changes.slice(-5)).map((change, i) => (
            <li key={`${change.at}-${i}`}>
              <time dateTime={change.at}>
                {new Date(change.at).toLocaleString()}
              </time>
              <ColumnChip column={change.column} />
              <p>{change.reason}</p>
            </li>
          ))}
        </ol>
      )}
      {!query.error &&
        !changes.length &&
        (query.isPending ? (
          <div role="status" aria-label="Loading history">
            <Skeleton className="h-12 w-full" />
            <span className="sr-only">Loading history…</span>
          </div>
        ) : (
          <EmptyState compact title="No status changes recorded." />
        ))}
      {changes.length > 5 && (
        <button
          aria-expanded={all}
          aria-controls="session-status-changes"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show last 5' : 'Show all'} ({changes.length})
        </button>
      )}
    </section>
  );
}

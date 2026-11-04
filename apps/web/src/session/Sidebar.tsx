import type { SessionDetailResponse } from '@c9view/api';
import { useState } from 'react';
import type { Message } from '@c9view/api';
import { money, number } from '../ui.js';
import { EmptyState } from '../kit/index.js';
import { modelLabel } from '../kit/model.js';
import { Timeline } from './Navigation.js';
export function Sidebar({
  data,
  projectId,
  sessionId,
}: {
  data: SessionDetailResponse;
  projectId: string;
  sessionId: string;
}) {
  const { session } = data;
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <h2 className={`session-details-heading ${open ? '' : 'is-collapsed'}`}>
        <button
          className="rail-disclosure"
          aria-expanded={open}
          aria-controls="session-details-body"
          onClick={() => setOpen(!open)}
        >
          Session details <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
      </h2>
      {open && (
        <div id="session-details-body" className="space-y-4">
          <section>
            <h3>Usage</h3>
            <dl className="space-y-2 text-xs">
              {(
                [
                  ['Input', session.tokens.input],
                  ['Output', session.tokens.output],
                  ['Cache read', session.tokens.cacheRead],
                  ['Cache write', session.tokens.cacheCreation],
                  ['Thinking', session.tokens.thinking],
                ] as const
              ).map(([label, value]) => (
                <div className="flex justify-between gap-2" key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums">{number(value)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-2 border-t border-line pt-2">
                <dt>API-equivalent</dt>
                <dd className="tabular-nums">
                  ≈{money(session.costUsd)}
                  <span className="sr-only">
                    {' '}
                    approximate API-equivalent cost, not actual billing
                  </span>
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-xs text-muted">
              Estimated at API list prices; not your actual bill on a
              subscription plan.
            </p>
            <h3 className="mt-4 mb-2 text-xs font-semibold">Models</h3>
            {session.models.length ? (
              session.models.map((model) => (
                <p
                  className="break-all font-mono text-small text-muted"
                  key={model}
                >
                  {model}
                </p>
              ))
            ) : (
              <EmptyState compact title="No model data." />
            )}
          </section>
          <section>
            <h3>Tools</h3>
            {Object.entries(data.toolUseCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => (
                <div
                  className="flex justify-between gap-2 py-1 text-xs"
                  key={name}
                >
                  <span className="break-all font-mono text-small">{name}</span>
                  <span className="tabular-nums">{count}</span>
                </div>
              ))}
            {!Object.keys(data.toolUseCounts).length && (
              <EmptyState compact title="No tool calls." />
            )}
          </section>
          <section className="space-y-3">
            <div>
              <h3 className="text-xs text-muted">Permission modes</h3>
              <p className="mt-1 break-all text-xs">
                {data.permissionModes.join(', ') || 'Unknown'}
              </p>
            </div>
            <p className="text-xs">Errors: {data.errorCount}</p>
            <div>
              <h3 className="text-xs text-muted">Working directory</h3>
              <p className="mt-1 break-all font-mono text-small">
                {data.cwd ?? 'Unknown'}
              </p>
            </div>
            <p className="text-xs text-muted">
              Version: {data.version ?? 'Unknown'}
            </p>
          </section>
          {session.liveName && (
            <p className="text-xs text-muted">Live name: {session.liveName}</p>
          )}
          <Timeline projectId={projectId} sessionId={sessionId} />
        </div>
      )}
    </section>
  );
}

export function Subagents({
  data,
  messages,
  jump,
  requestedAgent,
}: {
  data: SessionDetailResponse;
  messages: Message[];
  jump: (id: string) => void;
  requestedAgent?: { id: string } | undefined;
}) {
  const [all, setAll] = useState(false);
  const [dismissedAgent, setDismissedAgent] = useState<{ id: string }>();
  const expanded =
    all || (!!requestedAgent && requestedAgent !== dismissedAgent);
  return (
    <section className="panel">
      <div className="rail-heading">
        <h2>Subagents</h2>
        <span className="text-xs text-muted">{data.subagents.length}</span>
      </div>
      <div id="session-subagents">
        {(expanded ? data.subagents : data.subagents.slice(0, 3)).map(
          (agent) => {
            const call = messages
              .flatMap((message) => message.blocks)
              .find(
                (block) =>
                  block.type === 'tool_use' &&
                  block.id === agent.parentToolUseId,
              );
            const input =
              call?.type === 'tool_use' &&
              call.input &&
              typeof call.input === 'object'
                ? (call.input as Record<string, unknown>)
                : {};
            const metadata = [
              agent.agentId.slice(0, 8),
              typeof input.subagent_type === 'string'
                ? input.subagent_type
                : null,
              typeof input.model === 'string' ? modelLabel(input.model) : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <button
                key={agent.agentId}
                id={`subagent-${encodeURIComponent(agent.agentId)}`}
                className="subagent-row"
                style={{ minHeight: 44 }}
                aria-disabled={!agent.parentToolUseId || undefined}
                title={
                  !agent.parentToolUseId ? 'Parent call not loaded' : undefined
                }
                onClick={() =>
                  agent.parentToolUseId && jump(agent.parentToolUseId)
                }
              >
                <span>{agent.description ?? 'No description'}</span>
                <span className="font-mono text-small text-muted">
                  {metadata}
                </span>
              </button>
            );
          },
        )}
      </div>
      {data.subagents.length > 3 && (
        <button
          className="rail-show-all text-xs text-accent"
          aria-expanded={expanded}
          aria-controls="session-subagents"
          onClick={() => {
            setAll(!expanded);
            setDismissedAgent(requestedAgent);
          }}
        >
          {expanded ? 'Show first 3' : `Show all ${data.subagents.length}`}
        </button>
      )}
      {!data.subagents.length && <EmptyState compact title="No subagents." />}
    </section>
  );
}

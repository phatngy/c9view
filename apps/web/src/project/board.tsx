import { useControl } from '../control/useControl.js';
import { useLabels } from '../control/useLabels.js';
import { SessionTitle } from '../control/SessionLabel.js';
import { BypassBadge, DrivenBadge } from '../control/cards.js';
import { isActiveRun } from '../control/runState.js';
import { useMachineId } from '../machine.js';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { SessionSummary } from '@c9view/api';
import { GitBranch } from 'lucide-react';
import { Badge, Button } from '../kit/index.js';
import { labels, number, relative, total } from '../ui.js';
import { boardColumns } from './sessions.js';

export function Kanban({
  sessions,
  projectId,
}: {
  sessions: SessionSummary[];
  projectId: string;
}) {
  const machineId = useMachineId();
  const control = useControl();
  const { labelFor } = useLabels();
  const [inactiveLimit, setInactiveLimit] = useState(30);
  return (
    <div className="project-board">
      {boardColumns.map((column) => {
        const items = sessions.filter(
          (session) => session.status.column === column,
        );
        const visible =
          column === 'inactive' ? items.slice(0, inactiveLimit) : items;
        return (
          <section
            className={`project-column${items.length ? '' : ' project-column-empty'}`}
            aria-label={column}
            key={column}
          >
            <h2 className="mb-3">
              <Badge status={column}>
                {labels[column]} <span>{items.length}</span>
              </Badge>
            </h2>
            {visible.map((session) => (
              <Link
                className={`project-session${column === 'inactive' ? ' project-session-compact' : ''}`}
                to="/m/$machineId/projects/$projectId/sessions/$sessionId"
                params={{ machineId, projectId, sessionId: session.id }}
                key={session.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-medium">
                    <SessionTitle
                      projectId={projectId}
                      sessionId={session.id}
                      title={session.title}
                      label={labelFor(projectId, session.id)}
                    />
                  </h3>
                  <time
                    className="shrink-0 text-xs text-muted"
                    dateTime={session.lastAt ?? undefined}
                  >
                    {relative(session.lastAt)}
                  </time>
                </div>
                {control.ready &&
                  control.data?.runs.some(
                    (run) =>
                      run.projectId === projectId &&
                      run.sessionId === session.id &&
                      isActiveRun(run),
                  ) && <DrivenBadge compact />}
                {control.ready &&
                  control.data?.runs.some(
                    (run) =>
                      run.projectId === projectId &&
                      run.sessionId === session.id &&
                      isActiveRun(run) &&
                      run.mode === 'bypassPermissions',
                  ) && <BypassBadge compact />}
                {session.liveName && (
                  <span
                    className="text-xs text-muted"
                    aria-label="Live session"
                  >
                    Live
                  </span>
                )}
                {column !== 'inactive' && (
                  <>
                    <p className="project-status-reason">
                      {session.status.reason}
                    </p>
                    {session.lastMessagePreview && (
                      <p className="line-clamp-2 text-sm text-muted">
                        {session.lastMessagePreview}
                      </p>
                    )}
                    <div className="my-3 flex flex-wrap gap-1">
                      {session.models.map((model) => (
                        <Badge model={model} key={model} />
                      ))}
                      {session.gitBranch && (
                        <Badge>
                          <GitBranch size={12} aria-hidden="true" />
                          {session.gitBranch}
                        </Badge>
                      )}
                      {session.status.stale && <Badge>Stale</Badge>}
                    </div>
                    <p className="text-xs text-muted">
                      {number(session.messageCount)} messages ·{' '}
                      {number(total(session.tokens))} tokens
                    </p>
                  </>
                )}
              </Link>
            ))}
            {column === 'inactive' && items.length > inactiveLimit && (
              <Button
                className="w-full"
                onClick={() => setInactiveLimit((limit) => limit + 100)}
              >
                Show 100 more ({items.length - inactiveLimit} remaining)
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}

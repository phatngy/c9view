import { useMachineId } from '../machine.js';
import { Link, useParams } from '@tanstack/react-router';
import { Button } from '../kit/index.js';
import { useProject } from '../api.js';
import { StatusDot } from './StatusDot.js';

const urgency = ['need_input', 'in_progress', 'in_review', 'inactive'];
const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);

export function CurrentSessions({
  projectId,
  onNavigate,
}: {
  projectId: string;
  onNavigate?: () => void;
}) {
  const machineId = useMachineId();
  const query = useProject(projectId);
  const params = useParams({ strict: false });
  if (query.isPending)
    return (
      <div
        aria-label="Loading sessions"
        role="status"
        className="shell-nav-skeleton h-8 animate-pulse rounded-md bg-surface"
      />
    );
  if (query.error)
    return (
      <div className="shell-project-error flex flex-col gap-1.5 p-2 text-caption text-muted">
        <span>Sessions unavailable.</span>
        <Button size="sm" onClick={() => void query.refetch()}>
          Retry sessions
        </Button>
      </div>
    );
  const sessions = [...query.data.sessions]
    .sort(
      (a, b) =>
        urgency.indexOf(a.status.column) - urgency.indexOf(b.status.column) ||
        time(b.lastAt) - time(a.lastAt),
    )
    .slice(0, 3);
  return (
    <div className="shell-project-sessions mt-[3px] mb-[7px] ml-5 border-l border-line pl-2.5">
      {sessions.map((session) => (
        <Link
          key={session.id}
          to="/m/$machineId/projects/$projectId/sessions/$sessionId"
          params={{ machineId, projectId, sessionId: session.id }}
          className="shell-session-link flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 text-caption text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[current]:bg-accent-soft data-[current]:text-ink sm:min-h-9"
          data-current={params.sessionId === session.id || undefined}
          aria-current={params.sessionId === session.id ? 'page' : undefined}
          onClick={onNavigate}
          title={session.title || 'Untitled session'}
        >
          <StatusDot column={session.status.column} />
          <span className="shell-truncate min-w-0 flex-1 truncate">
            {session.title || 'Untitled session'}
          </span>
        </Link>
      ))}
      <Link
        to="/m/$machineId/projects/$projectId"
        params={{ machineId, projectId }}
        search={{ tab: 'sessions', path: '', line: '' }}
        className="shell-all-sessions flex min-h-11 items-center px-2 py-1.5 text-caption text-muted sm:min-h-9"
        onClick={onNavigate}
      >
        All {query.data.sessions.length} sessions
      </Link>
    </div>
  );
}

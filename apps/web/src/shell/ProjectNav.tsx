import { useMachineId } from '../machine.js';
import { ChevronRight } from 'lucide-react';
import { Button, Skeleton, Tooltip } from '../kit/index.js';
import { Link, useParams } from '@tanstack/react-router';
import type { KanbanColumn, ProjectSummary } from '@c9view/api';
import { useProjects } from '../api.js';
import { labels } from '../ui.js';
import { CurrentSessions } from './CurrentSessions.js';
import { ProjectName } from './ProjectName.js';
import { StatusDot } from './StatusDot.js';
import { navLinkClass } from './navLinkClass.js';
import { boardColumns } from '../project/sessions.js';
import { formatProjectNameHint, projectNameHints } from '../projectNames.js';

const urgency: KanbanColumn[] = boardColumns;
const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);
export function projectStatus(project: ProjectSummary) {
  return urgency.find((column) => project.columns[column] > 0) ?? 'inactive';
}
export function visibleProjects(projects: ProjectSummary[], current?: string) {
  const sorted = [...projects].sort(
    (a, b) => time(b.lastActivityAt) - time(a.lastActivityAt),
  );
  const shown = sorted.slice(0, 8);
  const selected = sorted.find((project) => project.id === current);
  if (selected && !shown.includes(selected)) shown.push(selected);
  return shown;
}
export function ProjectNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const machineId = useMachineId();
  const query = useProjects();
  const params = useParams({ strict: false });
  if (query.isPending)
    return (
      <div
        role="status"
        aria-label="Loading projects"
        className="shell-projects-loading"
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    );
  if (query.error)
    return (
      <div
        className="shell-project-error flex flex-col gap-1.5 p-2 text-caption text-muted"
        role="alert"
      >
        <span>Projects unavailable.</span>
        <Button size="sm" onClick={() => void query.refetch()}>
          Retry projects
        </Button>
      </div>
    );
  const projects = query.data.projects ?? [];
  const nameHints = projectNameHints(projects);
  return (
    <div className="shell-projects flex flex-col gap-[3px]">
      {!collapsed && (
        <div className="shell-section-label flex justify-between px-2.5 pb-[7px] text-caption font-semibold tracking-[.08em] text-muted uppercase">
          <span>Projects</span>
          <span>{projects.length}</span>
        </div>
      )}
      {visibleProjects(projects, params.projectId).map((project) => {
        const column = projectStatus(project);
        const current = project.id === params.projectId;
        const nameHint = nameHints.get(project.id);
        const fullNameHint = nameHint
          ? formatProjectNameHint(nameHint)
          : undefined;
        const row = (
          <Link
            to="/m/$machineId/projects/$projectId"
            params={{ machineId, projectId: project.id }}
            search={{ tab: 'sessions', path: '', line: '' }}
            activeOptions={{ exact: true }}
            className={navLinkClass}
            data-current={current || undefined}
            aria-label={`${project.name}${fullNameHint ? `, ${fullNameHint}` : ''}, ${column === 'inactive' ? 'Inactive' : `${project.columns[column]} ${labels[column].toLowerCase()}`}`}
            aria-current={current && !params.sessionId ? 'page' : undefined}
            onClick={onNavigate}
          >
            <StatusDot column={column} />
            {!collapsed && (
              <>
                <ProjectName
                  compact
                  name={project.name}
                  id={project.id}
                  hint={nameHint}
                />
                {column !== 'inactive' && (
                  <span
                    className="shell-project-count shrink-0"
                    data-column={column}
                  >
                    {project.columns[column]}
                  </span>
                )}
                {!current && <ChevronRight size={13} aria-hidden="true" />}
              </>
            )}
          </Link>
        );
        const tooltip = `${project.name}${fullNameHint ? ` · ${fullNameHint}` : ''}${column === 'inactive' ? '' : ` · ${project.columns[column]} ${labels[column].toLowerCase()}`}`;
        return (
          <div key={project.id}>
            {collapsed ? <Tooltip content={tooltip}>{row}</Tooltip> : row}
            {current && !collapsed && (
              <CurrentSessions
                projectId={project.id}
                {...(onNavigate ? { onNavigate } : {})}
              />
            )}
          </div>
        );
      })}
      {!collapsed && (
        <Link
          to="/m/$machineId"
          params={{ machineId }}
          className="shell-all-sessions flex min-h-11 items-center px-2 py-1.5 text-caption text-muted sm:min-h-9"
          onClick={onNavigate}
        >
          Show all projects
        </Link>
      )}
      {!collapsed && projects.length === 0 && (
        <p className="shell-project-error flex flex-col gap-1.5 p-2 text-caption text-muted">
          No projects yet.
        </p>
      )}
    </div>
  );
}

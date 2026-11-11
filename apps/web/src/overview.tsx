import { useMachineId } from './machine.js';
import { ProjectName } from './shell/ProjectName.js';
import { useBreadcrumbs } from './shell/breadcrumbs.js';
import { lazy, Suspense, useRef, useState } from 'react';
import { NewProjectDialog } from './control/NewProjectDialog.js';
import { useWorkspaceRoots } from './control/useWorkspaceRoots.js';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useOverview, useProjects } from './api.js';
import { Badge, Button, SegmentedControl, Select, Stat } from './kit/index.js';
import { rangeOptions, useRangeUsage } from './overview/usage.js';
import { boardColumns } from './project/sessions.js';
import { projectNameHints } from './projectNames.js';
import {
  labels,
  Empty,
  Failure,
  Loading,
  money,
  number,
  relative,
  total,
} from './ui.js';

const UsageSection = lazy(() =>
  import('./usage/UsageSection.js').then((m) => ({ default: m.UsageSection })),
);

export function OverviewPage() {
  const projects = useProjects();
  const { project } = useSearch({ from: '/m/$machineId' });
  // Resolve deep-link scope before mounting usage queries.
  if (project && projects.isPending) return <Loading />;
  return <OverviewContent />;
}

function OverviewContent() {
  const machineId = useMachineId();
  useBreadcrumbs([{ label: 'Overview' }]);
  const overview = useOverview();
  const projects = useProjects();
  const {
    range = 30,
    status,
    project: requestedProject,
  } = useSearch({ from: '/m/$machineId' });
  const navigate = useNavigate({ from: '/m/$machineId' });
  const selectedProject = projects.data?.projects.find(
    (p) => p.id === requestedProject,
  );
  const projectId = selectedProject?.id ?? '';
  const [search, setSearch] = useState('');
  const { roots } = useWorkspaceRoots();
  const [projectDialog, setProjectDialog] = useState(false);
  const newProjectButton = useRef<HTMLButtonElement | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const usage = useRangeUsage(range, projectId);
  if (overview.error || projects.error)
    return (
      <Failure
        error={(overview.error || projects.error)!}
        retry={() => {
          void overview.refetch();
          void projects.refetch();
        }}
      />
    );
  if (!overview.data || !projects.data) return <Loading />;
  const data = overview.data;
  const filtered = projects.data.projects
    .filter(
      (p) =>
        `${p.name} ${p.path}`.toLowerCase().includes(search.toLowerCase()) &&
        (!status || p.columns[status] > 0),
    )
    .sort((a, b) =>
      (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
    );
  const usageData = usage.error ? undefined : usage.data;
  const nameHints = projectNameHints(projects.data.projects);
  const shownProjects = showAllProjects ? filtered : filtered.slice(0, 10);
  const tokens = usageData?.totals.tokens;
  const denominator = tokens
    ? tokens.input + tokens.cacheRead + tokens.cacheCreation
    : 0;
  const cacheHit =
    tokens && denominator ? tokens.cacheRead / denominator : null;
  const dailyMax = Math.max(
    0,
    ...(usageData?.days.map((d) => d.costUsd) ?? []),
  );
  return (
    <div className="overview-page space-y-6">
      <header className="overview-header">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Overview</h1>
          <p className="mt-1 text-muted">
            Your Claude Code activity, in one place.
          </p>
        </div>
        <div className="overview-controls">
          <SegmentedControl
            label="Usage range"
            options={rangeOptions}
            value={String(range)}
            onValueChange={(value) =>
              void navigate({
                search: (prev) => ({ ...prev, range: Number(value) }),
              })
            }
          />
          <Select
            label="Usage project"
            value={projectId || 'all'}
            onValueChange={(value) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  project: value === 'all' ? undefined : value,
                }),
              })
            }
            options={[
              { value: 'all', label: 'All projects' },
              ...projects.data.projects.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ]}
          />
          {range === 366 && (
            <span className="text-xs text-muted">All = last 366 days</span>
          )}
          {roots.length > 0 && (
            <>
              <Button
                variant="primary"
                buttonRef={(button) => (newProjectButton.current = button)}
                onClick={() => setProjectDialog(true)}
              >
                New project
              </Button>
              <NewProjectDialog
                open={projectDialog}
                onOpenChange={setProjectDialog}
                finalFocus={() => newProjectButton.current}
              />
            </>
          )}
        </div>
      </header>
      <div className="overview-stats" aria-busy={usage.isFetching}>
        <section
          className="panel overview-cost"
          aria-label="Selected range cost"
        >
          <Stat
            label="API-equivalent cost"
            value={
              usageData
                ? `≈ ${money(usageData.totals.costUsd)}${selectedProject ? ` · ${selectedProject.name}` : ''}`
                : '—'
            }
            detail={
              tokens
                ? `${number(total(tokens))} tokens · last ${range} days${selectedProject ? '' : ' · workspace'}`
                : 'Usage unavailable'
            }
          />
          {usageData && (
            <div
              className="overview-cost-trend"
              style={{ gap: usageData.days.length > 90 ? 0 : 2 }}
              role="img"
              aria-label={`Daily API-equivalent cost, ${usageData.from} to ${usageData.to}`}
            >
              {usageData.days.map((day) => (
                <span
                  key={day.date}
                  style={{
                    height: `${dailyMax ? (day.costUsd / dailyMax) * 100 : 0}%`,
                  }}
                  title={`${day.date}: ≈ ${money(day.costUsd)} API-equivalent`}
                />
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            Daily cost · <a href="#api-equivalent-cost">About estimates</a>
          </p>
        </section>
        <section className="panel" aria-label="Selected range cache hit">
          <Stat
            label="Cache hit"
            value={
              !usageData
                ? '—'
                : cacheHit === null
                  ? 'No usage'
                  : `${(cacheHit * 100).toFixed(1)}%`
            }
            detail="Cache read ÷ input, cache read and cache creation"
          />
          <div
            className="overview-cache-track"
            role="meter"
            aria-label="Cache-hit ratio"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={cacheHit === null ? undefined : cacheHit * 100}
            aria-valuetext={cacheHit === null ? 'No usage' : undefined}
          >
            <span style={{ width: `${(cacheHit ?? 0) * 100}%` }} />
          </div>
        </section>
        <section className="panel">
          <Stat
            label="Live sessions"
            value={data.liveSessionCount}
            detail={`${data.sessionCount} sessions across ${data.projectCount} projects · workspace now`}
          />
        </section>
      </div>
      <p className="text-xs text-muted">
        Session status totals are workspace-wide.
      </p>
      <div
        className="overview-status"
        role="group"
        aria-label="Filter projects by status"
      >
        {boardColumns.map((column) => (
          <button
            key={column}
            type="button"
            aria-pressed={status === column}
            onClick={() => {
              setShowAllProjects(false);
              void navigate({
                search: (prev) => ({
                  ...prev,
                  status: status === column ? undefined : column,
                }),
              });
            }}
          >
            <Badge status={column}>{labels[column]}</Badge>
            <strong>{data.columns[column]}</strong>
          </button>
        ))}
      </div>
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="mb-0!">
            Projects <span className="text-muted">{filtered.length}</span>
          </h2>
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search name or path…"
            value={search}
            onChange={(e) => {
              setShowAllProjects(false);
              setSearch(e.target.value);
            }}
            className="w-full sm:w-72"
          />
        </div>
        <p className="mb-3 text-xs text-muted">Project totals are all-time.</p>
        {filtered.length ? (
          <div
            className="overview-project-scroll"
            role="region"
            aria-label="Projects table"
            tabIndex={0}
          >
            <table className="overview-projects">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Sessions by status</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">
                    <a href="#api-equivalent-cost">≈ API-equivalent cost</a>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shownProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        to="/m/$machineId/projects/$projectId"
                        params={{ machineId, projectId: p.id }}
                      >
                        <h3 className="font-semibold">
                          <ProjectName
                            name={p.name}
                            id={p.id}
                            hint={nameHints.get(p.id)}
                          />
                        </h3>
                      </Link>
                      <p
                        className="overview-project-path font-mono text-small text-muted"
                        title={p.path}
                      >
                        {p.path}
                      </p>
                    </td>
                    <td>
                      <div className="overview-project-status">
                        {boardColumns
                          .filter((column) => p.columns[column] > 0)
                          .map((column) => (
                            <Badge key={column} status={column}>
                              {labels[column]} {p.columns[column]}
                            </Badge>
                          ))}
                      </div>
                    </td>
                    <td>
                      <time
                        dateTime={p.lastActivityAt ?? undefined}
                        title={p.lastActivityAt ?? undefined}
                      >
                        {relative(p.lastActivityAt)}
                      </time>
                    </td>
                    <td>{number(total(p.tokens))}</td>
                    <td>≈ {money(p.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 10 && (
              <Button
                variant="ghost"
                className="my-2 min-h-11"
                aria-expanded={showAllProjects}
                onClick={() => setShowAllProjects((expanded) => !expanded)}
              >
                {showAllProjects
                  ? 'Show fewer'
                  : `Show all ${filtered.length} projects`}
              </Button>
            )}
          </div>
        ) : (
          <Empty>
            {search || status
              ? 'No projects match your filters.'
              : 'No projects found yet.'}
          </Empty>
        )}
      </section>
      <Suspense fallback={<Loading />}>
        <UsageSection range={range} projectId={projectId} showSummary={false} />
      </Suspense>
    </div>
  );
}

import { useBreadcrumbs } from './shell/breadcrumbs.js';
import { lazy, Suspense, useState } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useProject } from './api.js';
import { Empty, Failure, Loading } from './ui.js';
import { Tabs, SegmentedControl, EmptyState } from './kit/index.js';
import { rangeOptions } from './overview/usage.js';
import { ProjectHeader } from './project/header.js';
import { Kanban } from './project/board.js';
import { SessionList } from './project/list.js';
import { SessionControls } from './project/controls.js';
import { selectSessions } from './project/sessions.js';

export { Kanban } from './project/board.js';

const UsageSection = lazy(() =>
  import('./usage/UsageSection.js').then((m) => ({ default: m.UsageSection })),
);

const ConfigSections = lazy(() =>
  import('./config.js').then((module) => ({ default: module.ConfigSections })),
);

const ProjectFiles = lazy(() =>
  import('./files/ProjectFiles.js').then((module) => ({
    default: module.ProjectFiles,
  })),
);
const ProjectChanges = lazy(() =>
  import('./files/ProjectChanges.js').then((module) => ({
    default: module.ProjectChanges,
  })),
);

export function ProjectPage({ projectId }: { projectId: string }) {
  const query = useProject(projectId);
  useBreadcrumbs([
    { label: 'Overview', to: '/m/$machineId' },
    { label: query.data?.project.name ?? projectId },
  ]);
  const search = useSearch({ from: '/m/$machineId/projects/$projectId' });
  const { tab, path, line, view, filter, sort } = search;
  const navigate = useNavigate({ from: '/m/$machineId/projects/$projectId' });
  const [range, setRange] = useState(30);
  const update = (change: { view?: string; filter?: string; sort?: string }) =>
    void navigate({
      search: (previous) => ({ ...previous, ...change }),
      replace: true,
    });
  if (query.error) return <Failure error={query.error} retry={query.refetch} />;
  if (!query.data) return <Loading />;
  const { project, sessions, config } = query.data;
  const selected = selectSessions(sessions, filter, sort);
  const content =
    tab === 'sessions' ? (
      <div className="space-y-4">
        <SessionControls
          view={view}
          filter={filter}
          sort={sort}
          onChange={update}
        />
        {view === 'list' ? (
          <SessionList
            sessions={selected}
            projectId={projectId}
            sort={sort}
            onSort={(sort) => update({ sort })}
          />
        ) : (
          <Kanban sessions={selected} projectId={projectId} />
        )}
        {!selected.length &&
          (sessions.length ? (
            <Empty>No sessions match your filters.</Empty>
          ) : (
            <EmptyState
              title="No sessions in this project yet"
              text="No sessions found yet."
            />
          ))}
      </div>
    ) : (
      <Suspense fallback={<Loading />}>
        {tab === 'usage' ? (
          <div className="space-y-4">
            <SegmentedControl
              label="Usage range"
              value={String(range)}
              options={rangeOptions}
              onValueChange={(value) => setRange(Number(value))}
            />
            <UsageSection projectId={projectId} range={range} />
          </div>
        ) : tab === 'files' ? (
          <ProjectFiles
            projectId={projectId}
            path={path}
            line={line}
            select={(path) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  tab: 'files',
                  path,
                  line: '',
                }),
                hash: '',
              })
            }
          />
        ) : tab === 'changes' ? (
          <ProjectChanges projectId={projectId} />
        ) : (
          <ConfigSections config={config} />
        )}
      </Suspense>
    );
  return (
    <div className="project-page space-y-5">
      <ProjectHeader project={project} />
      <Tabs
        label="Project sections"
        value={tab}
        onValueChange={(tab) =>
          void navigate({
            search: (previous) => ({ ...previous, tab, path: '', line: '' }),
          })
        }
        items={[
          { value: 'sessions', label: 'Sessions' },
          { value: 'usage', label: 'Usage' },
          { value: 'files', label: 'Files' },
          { value: 'changes', label: 'Changes' },
          { value: 'config', label: 'Config' },
        ].map((item) => ({
          ...item,
          content: item.value === tab ? content : undefined,
        }))}
      />
    </div>
  );
}

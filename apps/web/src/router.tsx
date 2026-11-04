import { lazy, Suspense } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  notFound,
  Link,
  type SearchSchemaInput,
} from '@tanstack/react-router';
import { useMachineId } from './machine.js';
import { App } from './App.js';
import { Loading, columns } from './ui.js';
import type { KanbanColumn } from '@c9view/api';

const OverviewPage = lazy(() =>
  import('./overview.js').then((module) => ({ default: module.OverviewPage })),
);
const ProjectPage = lazy(() =>
  import('./project.js').then((module) => ({ default: module.ProjectPage })),
);
const SessionPage = lazy(() =>
  import('./session.js').then((module) => ({ default: module.SessionPage })),
);
const ConfigPage = lazy(() =>
  import('./config-page.js').then((module) => ({ default: module.ConfigPage })),
);
const SearchPage = lazy(() =>
  import('./search/SearchPage.js').then((module) => ({
    default: module.SearchPage,
  })),
);
const root = createRootRoute({
  component: App,
  notFoundComponent: function NotFound() {
    const machineId = useMachineId();
    return (
      <div className="panel">
        <h1>Page not found</h1>
        <Link to="/m/$machineId" params={{ machineId }}>
          Back to overview
        </Link>
      </div>
    );
  },
});
const overview = createRoute({
  getParentRoute: () => root,
  path: '/m/$machineId',
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) => ({
    project: typeof search.project === 'string' ? search.project : undefined,
    status: columns.includes(search.status as KanbanColumn)
      ? (search.status as KanbanColumn)
      : undefined,
    range:
      (typeof search.range === 'string' || typeof search.range === 'number') &&
      [7, 30, 90, 366].includes(Number(search.range))
        ? Number(search.range)
        : undefined,
  }),
  component: () => (
    <Suspense fallback={<Loading />}>
      <OverviewPage />
    </Suspense>
  ),
});
const project = createRoute({
  getParentRoute: () => root,
  path: '/m/$machineId/projects/$projectId',
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) => ({
    tab:
      typeof search.tab === 'string' &&
      ['sessions', 'usage', 'files', 'changes', 'config'].includes(search.tab)
        ? search.tab
        : 'sessions',
    view: search.view === 'list' ? 'list' : 'board',
    filter:
      typeof search.filter === 'string' || typeof search.filter === 'number'
        ? String(search.filter)
        : '',
    sort:
      typeof search.sort === 'string' &&
      /^(title|status|model|branch|activity|messages|tokens|cost)-(asc|desc)$/.test(
        search.sort,
      )
        ? search.sort
        : 'activity-desc',
    path: typeof search.path === 'string' ? search.path : '',
    line:
      typeof search.line === 'string' || typeof search.line === 'number'
        ? String(search.line)
        : '',
  }),
  component: () => (
    <Suspense fallback={<Loading />}>
      <ProjectPage projectId={project.useParams().projectId} />
    </Suspense>
  ),
});
const session = createRoute({
  getParentRoute: () => root,
  path: '/m/$machineId/projects/$projectId/sessions/$sessionId',
  component: () => {
    const params = session.useParams();
    return (
      <Suspense fallback={<Loading />}>
        <SessionPage {...params} />
      </Suspense>
    );
  },
});
const config = createRoute({
  getParentRoute: () => root,
  path: '/m/$machineId/config',
  component: () => (
    <Suspense fallback={<Loading />}>
      <ConfigPage />
    </Suspense>
  ),
});
const search = createRoute({
  getParentRoute: () => root,
  path: '/m/$machineId/search',
  validateSearch: (search: Record<string, unknown> & SearchSchemaInput) => ({
    q: typeof search.q === 'string' ? search.q : '',
    projectId: typeof search.projectId === 'string' ? search.projectId : '',
    from: typeof search.from === 'string' ? search.from : '',
    to: typeof search.to === 'string' ? search.to : '',
    model: typeof search.model === 'string' ? search.model : '',
  }),
  component: () => (
    <Suspense fallback={<Loading />}>
      <SearchPage />
    </Suspense>
  ),
});
const legacyRoot = createRoute({
  getParentRoute: () => root,
  path: '/',
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/m/local${location.searchStr}${location.hash ? `#${location.hash}` : ''}`,
      replace: true,
    });
  },
});
const legacyPath = createRoute({
  getParentRoute: () => root,
  path: '$',
  beforeLoad: ({ location }) => {
    if (location.pathname === '/m' || location.pathname === '/m/')
      throw redirect({
        href: `/m/local${location.searchStr}${location.hash ? `#${location.hash}` : ''}`,
        replace: true,
      });
    if (!location.pathname.startsWith('/m/'))
      throw redirect({
        href: `/m/local${location.pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ''}`,
        replace: true,
      });
    throw notFound();
  },
});
export const routeTree = root.addChildren([
  legacyRoot,
  legacyPath,
  overview,
  project,
  session,
  config,
  search,
]);
export const router = createRouter({ routeTree });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

import '../project.js';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { projectDetail } from '../test-fixtures.js';
import { router as appRouter, routeTree } from '../router.js';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

it('accepts usage as a project tab and falls back for unknown tabs', () => {
  const validateSearch = appRouter.routesById[
    '/m/$machineId/projects/$projectId'
  ].options.validateSearch as (search: Record<string, unknown>) => {
    tab: string;
  };

  expect(validateSearch({ tab: 'usage' }).tab).toBe('usage');
  expect(validateSearch({ tab: 'unknown' }).tab).toBe('sessions');
});

it('keeps a digit-only URL filter as a string', () => {
  const validateSearch = appRouter.routesById[
    '/m/$machineId/projects/$projectId'
  ].options.validateSearch as (search: Record<string, unknown>) => {
    filter: string;
  };

  expect(validateSearch({ filter: 123 }).filter).toBe('123');
});

it('renders inactive sessions as compact project cards', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => projectDetail,
    })),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ['/m/local/projects/project-1'],
    }),
    defaultPendingMinMs: 0,
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const inactive = await screen.findByRole('region', { name: 'inactive' });
  const card = within(inactive).getByRole('link', { name: /Task inactive/ });
  expect(card).toHaveClass('project-session-compact');
  expect(within(card).queryByText('Transcript signal')).not.toBeInTheDocument();
});

it('exposes aria-sort on the sorted project session table header', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => projectDetail,
    })),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ['/m/local/projects/project-1?view=list&sort=title-asc'],
    }),
    defaultPendingMinMs: 0,
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await screen.findByRole('region', { name: 'Sessions table' });
  expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
});

it('shows distinct empty states for projects without sessions and filtered results', async () => {
  const emptyProjectDetail = { ...projectDetail, sessions: [] };
  const renderProject = async (
    entry: string,
    response: typeof projectDetail,
  ) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => response,
      })),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [entry] }),
      defaultPendingMinMs: 0,
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  };

  await renderProject('/m/local/projects/project-1', emptyProjectDetail);
  expect(
    await screen.findByText('No sessions in this project yet'),
  ).toBeInTheDocument();
  cleanup();

  await renderProject(
    '/m/local/projects/project-1?filter=missing',
    projectDetail,
  );
  expect(
    await screen.findByText('No sessions match your filters.'),
  ).toBeInTheDocument();
});

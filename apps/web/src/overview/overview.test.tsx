import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectsResponse, UsageResponse } from '@c9view/api';
import { api } from '../api.js';
import { routeTree } from '../router.js';
import { overview, project, tokens } from '../test-fixtures.js';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
  localStorage.clear();
});
function usage(costUsd = 6): UsageResponse {
  return {
    from: '2026-10-01',
    to: '2026-10-30',
    tz: 'UTC',
    totals: { costUsd, tokens },
    days: [
      {
        date: '2026-10-30',
        costUsd,
        tokens,
        byModel: [{ model: 'claude-opus-4', costUsd, tokens }],
      },
    ],
    byModel: [{ model: 'claude-opus-4', costUsd, tokens }],
    byProject: [],
    cacheHit: [{ date: '2026-10-30', ratio: 0.5 }],
  };
}
function open(path = '/', pendingProjects?: Promise<ProjectsResponse>) {
  vi.spyOn(api, 'overview').mockResolvedValue(overview);
  vi.spyOn(api, 'projects').mockResolvedValue({
    projects: [
      {
        ...project,
        id: 'older',
        name: 'Older',
        lastActivityAt: null,
        columns: { inactive: 1, need_input: 0, in_progress: 0, in_review: 0 },
      },
      project,
    ],
  });
  if (pendingProjects) vi.mocked(api.projects).mockReturnValue(pendingProjects);
  const query = vi.spyOn(api, 'usage').mockImplementation(async (filters) => {
    const days =
      (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000 + 1;
    return usage(filters.projectId ? 2 : days);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPendingMinMs: 0,
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, query };
}
it('shares the header range and project filter between headline totals and charts', async () => {
  const { query, router } = open();
  const cost = await screen.findByRole('region', {
    name: 'Selected range cost',
  });
  await waitFor(() => expect(cost).toHaveTextContent('≈ $30.00'));
  expect(cost).toHaveTextContent('175 tokens');
  const cache = screen.getByRole('region', {
    name: 'Selected range cache hit',
  });
  expect(cache).toHaveTextContent('15.4%');
  expect(screen.getByRole('meter')).toHaveAttribute(
    'aria-valuenow',
    String((20 / 130) * 100),
  );
  const range = screen.getByRole('group', { name: 'Usage range' });
  const selected = within(range).getByRole('button', { name: '30d' });
  selected.focus();
  fireEvent.keyDown(selected, { key: 'ArrowLeft' });
  await waitFor(() => expect(cost).toHaveTextContent('≈ $7.00'));
  expect(within(range).getByRole('button', { name: '7d' })).toHaveFocus();
  expect(router.state.location.search.range).toBe(7);
  await waitFor(() =>
    expect(
      screen.getByRole('img', { name: /Daily API-equivalent cost from/ }),
    ).toHaveAccessibleName(/total ≈ \$7.00/),
  );
  fireEvent.click(screen.getByRole('combobox', { name: 'Usage project' }));
  const option = await screen.findByRole('option', { name: 'Dashboard' });
  fireEvent.pointerDown(option, { pointerType: 'mouse' });
  fireEvent.click(option);
  await waitFor(() => expect(cost).toHaveTextContent('≈ $2.00'));
  expect(query.mock.calls.at(-1)?.[0].projectId).toBe(project.id);
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  fireEvent.click(within(range).getByRole('button', { name: 'All' }));
  await waitFor(() => expect(router.state.location.search.range).toBe(366));
  expect(screen.getByText('All = last 366 days')).toBeVisible();
  const filters = query.mock.calls.at(-1)![0];
  expect(
    (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000 + 1,
  ).toBe(366);
});
it.each(['inactive', 'need_input', 'in_progress', 'in_review'])(
  'round-trips the %s status and toggles it off with a native keyboard-operable button',
  async (status) => {
    const { router } = open(`/?status=${status}&range=90`);
    const group = await screen.findByRole('group', {
      name: 'Filter projects by status',
    });
    const selected = within(group)
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-pressed') === 'true')!;
    expect(selected).toBeDefined();
    expect(router.state.location.search.status).toBe(status);
    expect(screen.getByRole('button', { name: '90d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = screen.getByRole('region', { name: 'Projects table' });
    expect(within(table).queryByRole('link', { name: 'Older' }) !== null).toBe(
      status === 'inactive',
    );
    selected.focus();
    expect(selected.tagName).toBe('BUTTON');
    expect(selected).toHaveFocus();
    // Native Enter/Space activation emits a click; real keyboard activation is also browser-checked.
    fireEvent.click(selected);
    await waitFor(() =>
      expect(router.state.location.search.status).toBeUndefined(),
    );
    expect(selected).toHaveAttribute('aria-pressed', 'false');
    expect(within(table).getByRole('link', { name: 'Older' })).toBeVisible();
    await act(async () => {
      router.history.back();
    });
    await waitFor(() =>
      expect(selected).toHaveAttribute('aria-pressed', 'true'),
    );
  },
);
it.each([7, 30, 90, 366])(
  'restores range %s from its serialized URL',
  async (range) => {
    open(`/?range=${range}`);
    const group = await screen.findByRole('group', { name: 'Usage range' });
    expect(
      within(group).getByRole('button', {
        name: range === 366 ? 'All' : `${range}d`,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Selected range cost' }),
      ).toHaveTextContent(`≈ $${range}.00`),
    );
  },
);
it('falls back for unknown URL values and sorts projects by most recent activity', async () => {
  open('/?status=unknown&range=365');
  const group = await screen.findByRole('group', {
    name: 'Filter projects by status',
  });
  expect(
    within(group)
      .getAllByRole('button')
      .every((button) => button.getAttribute('aria-pressed') === 'false'),
  ).toBe(true);
  expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const rows = within(
    screen.getByRole('region', { name: 'Projects table' }),
  ).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Dashboard');
  expect(rows[2]).toHaveTextContent('Older');
  for (const label of ['Inactive', 'Need input', 'In progress', 'In review'])
    expect(rows[1]).toHaveTextContent(label);
});
it('shows a zero cost and no cache usage without inventing a ratio', async () => {
  open();
  vi.mocked(api.usage).mockResolvedValue({
    ...usage(0),
    totals: {
      costUsd: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        thinking: 0,
      },
    },
  });
  const cost = await screen.findByRole('region', {
    name: 'Selected range cost',
  });
  await waitFor(() => expect(cost).toHaveTextContent('≈ $0.00'));
  expect(
    screen.getByRole('region', { name: 'Selected range cache hit' }),
  ).toHaveTextContent('No usage');
});

it.each([project.id, 'unknown-project'])(
  'waits for projects before requesting usage for deep link %s',
  async (requestedProject) => {
    let resolveProjects!: (response: ProjectsResponse) => void;
    const pendingProjects = new Promise<ProjectsResponse>((resolve) => {
      resolveProjects = resolve;
    });
    const { query } = open(`/?project=${requestedProject}`, pendingProjects);
    await waitFor(() => expect(api.projects).toHaveBeenCalled());
    expect(query).not.toHaveBeenCalled();
    await act(async () => resolveProjects({ projects: [project] }));
    await screen.findByRole('region', { name: 'Selected range cost' });
    await waitFor(() => expect(query).toHaveBeenCalled());
    const expectedProject = requestedProject === project.id ? project.id : '';
    expect(
      query.mock.calls.every(
        ([filters]) => filters.projectId === expectedProject,
      ),
    ).toBe(true);
  },
);

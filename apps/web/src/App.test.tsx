import './overview.js';
import './project.js';
import './session.js';
import './search/SearchPage.js';
import './config-page.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { routeTree } from './router.js';
import {
  globalConfig,
  messages,
  overview,
  project,
  projectDetail,
  sessionDetail,
  sessions,
} from './test-fixtures.js';
import { invalidateLiveEvent } from './live/index.js';
import { api } from './api.js';
import { Conversation } from './session.js';
import type { SessionDetailResponse } from '@c9view/api';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function mockApi(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    '/api/m/local/overview': overview,
    '/api/m/local/projects': { projects: [project] },
    '/api/m/local/projects/project-1': projectDetail,
    '/api/m/local/config': globalConfig,
    '/api/m/local/projects/project-1/sessions/session-0?from=end&limit=50':
      sessionDetail,
    '/api/m/local/projects/project-1/sessions/session-0/status': {
      status: sessionDetail.session.status,
      totalMessages: sessionDetail.totalMessages,
      lastAt: sessionDetail.session.lastAt,
    },
    ...overrides,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: url in responses,
      status: url in responses ? 200 : 404,
      json: async () => responses[url] ?? { error: 'Fixture not found' },
    })),
  );
}
function open(path = '/m/local') {
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
  return router;
}
describe('dashboard', () => {
  it('renders and filters project cards from the overview API', async () => {
    mockApi();
    open();
    expect(
      await screen.findByRole('heading', { name: 'Dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByText('/workspace/dashboard')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Projects table' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '≈ API-equivalent cost' }),
    ).toHaveAttribute('href', '#api-equivalent-cost');
    expect(screen.getByRole('cell', { name: '≈ $0.25' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'missing' },
    });
    expect(
      screen.getByText('No projects match your filters.'),
    ).toBeInTheDocument();
  });
  it('puts sessions into their contract columns', async () => {
    mockApi();
    open('/m/local/projects/project-1');
    await screen.findByRole('heading', { name: 'Dashboard' });
    for (const session of sessions)
      expect(
        within(
          screen.getByRole('region', { name: session.status.column }),
        ).getByRole('heading', { name: session.title }),
      ).toBeInTheDocument();
    expect(screen.getByLabelText('Live session')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Config' }));
    expect(
      await screen.findByRole('heading', { name: 'Memory' }),
    ).toBeInTheDocument();
  });
  it('opens Usage as a shareable tab with its own keyboard range picker', async () => {
    vi.spyOn(api, 'usage').mockResolvedValue({
      tz: 'UTC',
      from: '2026-10-01',
      to: '2026-10-28',
      days: [],
      byProject: [],
      byModel: [],
      totals: { tokens: project.tokens, costUsd: 0.25 },
      cacheHit: [],
    });
    mockApi();
    const router = open('/m/local/projects/project-1?tab=usage');
    const picker = await screen.findByRole('group', { name: 'Usage range' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Sessions',
      'Usage',
      'Files',
      'Changes',
      'Config',
    ]);
    expect(screen.getByRole('tab', { name: 'Usage' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.keyDown(within(picker).getByRole('button', { name: '30d' }), {
      key: 'ArrowLeft',
    });
    await waitFor(() =>
      expect(api.usage).toHaveBeenLastCalledWith(
        'local',
        expect.objectContaining({ projectId: 'project-1' }),
        expect.any(AbortSignal),
      ),
    );
    const filters = vi.mocked(api.usage).mock.lastCall![1];
    expect(
      (Date.parse(filters.to!) - Date.parse(filters.from!)) / 86400000,
    ).toBe(6);
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    await screen.findByRole('group', { name: 'Session view' });
    expect(
      screen.queryByRole('group', { name: 'Usage range' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(await screen.findByRole('button', { name: '7d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(router.state.location.search.tab).toBe('usage'));
    vi.restoreAllMocks();
  });
  it('orders board columns by urgency and collapses empty columns to headings', async () => {
    mockApi({
      '/api/m/local/projects/project-1': {
        ...projectDetail,
        sessions: [sessions[1]],
      },
    });
    open('/m/local/projects/project-1');
    const region = await screen.findByRole('region', { name: 'need_input' });
    expect(
      Array.from(region.parentElement!.children).map((item) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual(['need_input', 'in_progress', 'in_review', 'inactive']);
    const empty = screen.getByRole('region', { name: 'inactive' });
    expect(empty).toHaveClass('project-column-empty');
    expect(empty.children).toHaveLength(1);
    expect(within(empty).getByRole('heading')).toHaveTextContent('Inactive');
    expect(region).not.toHaveClass('project-column-empty');
  });
  it('shares filtering and sorting between Board and List and round-trips their URL state', async () => {
    mockApi();
    const router = open(
      '/m/local/projects/project-1?view=list&filter=main&sort=title-asc',
    );
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getByRole('link').textContent),
    ).toEqual([
      'Task in_progress',
      'Task in_review',
      'Task inactive',
      'Task need_input',
    ]);
    fireEvent.click(within(table).getByRole('button', { name: 'Title' }));
    await waitFor(() =>
      expect(router.state.location.search.sort).toBe('title-desc'),
    );
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
      'Task need_input',
    );
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Filter sessions' }),
      { target: { value: 'need_input' } },
    );
    await waitFor(() =>
      expect(within(table).getAllByRole('row')).toHaveLength(2),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    const board = await screen.findByRole('region', { name: 'need_input' });
    expect(within(board).getAllByRole('link')).toHaveLength(1);
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        view: 'board',
        filter: 'need_input',
        sort: 'title-desc',
      }),
    );
    const url = router.state.location.href;
    cleanup();
    const restored = open(url);
    expect(
      await screen.findByRole('searchbox', { name: 'Filter sessions' }),
    ).toHaveValue('need_input');
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(restored.state.location.search.sort).toBe('title-desc');
  });
  it('falls back to project defaults for unknown URL values', async () => {
    mockApi();
    const router = open(
      '/m/local/projects/project-1?tab=oops&view=oops&filter=%5B1%5D&sort=oops',
    );
    expect(
      await screen.findByRole('tab', { name: 'Sessions' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(router.state.location.search).toMatchObject({
      tab: 'sessions',
      view: 'board',
      filter: '',
      sort: 'activity-desc',
    });
  });
  it('keeps a digit-only filter from the URL', async () => {
    mockApi();
    const router = open('/m/local/projects/project-1?filter=2026');
    expect(await screen.findByRole('tab', { name: 'Sessions' })).toBeTruthy();
    expect(router.state.location.search.filter).toBe('2026');
  });
  it('moves cards on live status refresh without losing the session controls', async () => {
    mockApi();
    const router = open(
      '/m/local/projects/project-1?filter=Task&sort=title-asc',
    );
    const needInput = await screen.findByRole('region', { name: 'need_input' });
    expect(
      within(needInput).getByRole('heading', { name: 'Task need_input' }),
    ).toBeInTheDocument();
    mockApi({
      '/api/m/local/projects/project-1': {
        ...projectDetail,
        sessions: sessions.map((session) =>
          session.id === 'session-1'
            ? {
                ...session,
                status: {
                  ...session.status,
                  column: 'in_progress',
                  reason: 'Working on request',
                },
              }
            : session,
        ),
      },
    });
    await act(async () => {
      invalidateLiveEvent(clients[0]!, {
        machineId: 'local',
        event: {
          type: 'status',
          projectId: 'project-1',
          sessionId: 'session-1',
          column: 'in_progress',
        },
      });
    });
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'in_progress' })).getByText(
          'Working on request',
        ),
      ).toBeInTheDocument(),
    );
    expect(needInput).toHaveClass('project-column-empty');
    expect(router.state.location.search).toMatchObject({
      filter: 'Task',
      sort: 'title-asc',
    });
  });
  it('opens shareable Files links at the selected line and navigates to Changes', async () => {
    const listing = {
      path: '',
      entries: [{ name: 'demo.ts', path: 'demo.ts', type: 'file' }],
    } satisfies import('@c9view/api').FileListResponse;
    const file = {
      path: 'demo.ts',
      size: 20,
      language: 'text',
      binary: false,
      tooLarge: false,
      content: 'first\nsecond\nthird',
    } satisfies import('@c9view/api').FileContentResponse;
    mockApi({
      '/api/m/local/projects/project-1/files?path=': listing,
      '/api/m/local/projects/project-1/file?path=demo.ts': file,
      '/api/m/local/projects/project-1/git/status': {
        isRepo: false,
      } satisfies import('@c9view/api').GitStatusResponse,
    });
    open('/m/local/projects/project-1?tab=files&path=demo.ts&line=L2-L3');
    expect(
      await screen.findByLabelText('Line 2, selected'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(
      await screen.findByText('This project is not a Git repository.'),
    ).toBeInTheDocument();
  });
  it('switches the mobile session tabs between conversation and changed files', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mockApi({
      '/api/m/local/projects/project-1/sessions/session-0/changes': {
        files: [],
      } satisfies import('@c9view/api').SessionChangesResponse,
    });
    open('/m/local/projects/project-1/sessions/session-0');
    const nav = await screen.findByRole('navigation', {
      name: 'Session sections',
    });
    const tab = within(nav).getByRole('button', { name: 'Files' });
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(document.getElementById('session-conversation')).not.toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Files changed' }),
    ).toBeVisible();
    expect(await screen.findByText('No changed files.')).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Chat' }));
    expect(document.getElementById('session-conversation')).toBeVisible();
  });
  it('pairs tool results under their tool use and hides meta messages', async () => {
    mockApi();
    open('/m/local/projects/project-1/sessions/session-0');
    const output = await screen.findByText('Example tool output');
    expect(output.closest('article')).toHaveTextContent('Bash');
    expect(screen.getAllByText('Example tool output')).toHaveLength(1);
    expect(
      screen.queryByText('Private system message'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Show system messages' }),
    );
    expect(screen.getByText('Private system message')).toBeInTheDocument();
  });
  it('pairs tool results across pages', async () => {
    const first: SessionDetailResponse = {
      ...sessionDetail,
      messages: messages.slice(0, 2),
      nextCursor: 2,
    };
    const second: SessionDetailResponse = {
      ...sessionDetail,
      messages: messages.slice(2),
      cursor: 2,
      prevCursor: 0,
      nextCursor: null,
    };
    mockApi({
      '/api/m/local/projects/project-1/sessions/session-0?from=end&limit=50':
        second,
      '/api/m/local/projects/project-1/sessions/session-0?cursor=0&limit=2':
        first,
    });
    open('/m/local/projects/project-1/sessions/session-0');
    await screen.findByText('Example tool output');
    fireEvent.click(
      within(document.querySelector('.conversation-window')!).getByRole(
        'button',
        { name: 'Load earlier messages' },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Example tool output').closest('article'),
      ).toHaveTextContent('Bash'),
    );
    expect(screen.getAllByText('Example tool output')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });
  it('shows the API error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Claude directory unavailable' }),
      })),
    );
    open();
    expect(
      (await screen.findAllByRole('alert')).find((alert) =>
        alert.textContent?.includes('Claude directory unavailable'),
      ),
    ).toHaveTextContent('Claude directory unavailable');
  });
  it('renders global config and plugins', async () => {
    mockApi();
    open('/m/local/config');
    expect(
      await screen.findByRole('heading', { name: 'Plugins' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No plugins installed.')).toBeInTheDocument();
  });
  it('reveals inactive sessions in steps of 100', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      ...sessions[0]!,
      id: `inactive-${i}`,
      title: `Inactive task ${i}`,
    }));
    mockApi({
      '/api/m/local/projects/project-1': { ...projectDetail, sessions: many },
    });
    open('/m/local/projects/project-1');
    const region = await screen.findByRole('region', { name: 'inactive' });
    expect(within(region).getAllByRole('link')).toHaveLength(30);
    fireEvent.click(
      within(region).getByRole('button', {
        name: 'Show 100 more (5 remaining)',
      }),
    );
    expect(within(region).getAllByRole('link')).toHaveLength(35);
  });
  it('polls session status and loads new messages with one next page', async () => {
    const first = {
      ...sessionDetail,
      messages: messages.slice(0, 2),
      nextCursor: null,
      totalMessages: 2,
    };
    const second = {
      ...sessionDetail,
      messages: messages.slice(2),
      cursor: 2,
      prevCursor: 0,
      nextCursor: null,
    };
    mockApi({
      '/api/m/local/projects/project-1/sessions/session-0?from=end&limit=50':
        first,
      '/api/m/local/projects/project-1/sessions/session-0?cursor=2&limit=50':
        second,
      '/api/m/local/projects/project-1/sessions/session-0/status': {
        status: {
          ...sessionDetail.session.status,
          column: 'in_progress',
          reason: 'Live status: busy',
        },
        totalMessages: 3,
        lastAt: sessionDetail.session.lastAt,
      },
    });
    open('/m/local/projects/project-1/sessions/session-0');
    expect(await screen.findByText('Example tool output')).toBeInTheDocument();
    expect(screen.getByText('Live status: busy')).toBeInTheDocument();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url]) =>
            url ===
            '/api/m/local/projects/project-1/sessions/session-0?cursor=2&limit=50',
        ),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: '1 new messages' }),
    ).not.toBeInTheDocument();
  });
  it('renders markdown images as text and hardens links', async () => {
    const textMessage = {
      ...messages[1]!,
      uuid: 'markdown',
      blocks: [
        {
          type: 'text' as const,
          text: '![diagram](https://remote.test/a.png) [safe](https://example.test) [bad](javascript:alert(1))',
        },
      ],
    };
    const detail = {
      ...sessionDetail,
      messages: [textMessage],
      totalMessages: 1,
    };
    mockApi({
      '/api/m/local/projects/project-1/sessions/session-0?from=end&limit=50':
        detail,
      '/api/m/local/projects/project-1/sessions/session-0/status': {
        status: detail.session.status,
        totalMessages: 1,
        lastAt: null,
      },
    });
    open('/m/local/projects/project-1/sessions/session-0');
    await waitFor(() =>
      expect(screen.getByText('[image: diagram]')).toBeInTheDocument(),
    );
    expect(document.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'safe' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
  });
  it('follows system theme and persists an explicit selection', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mockApi();
    open();
    const toggle = await screen.findByRole('button', {
      name: 'Theme: system. Change theme',
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(toggle);
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: 'Light' }),
    );
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('c9view-theme')).toBe('light');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Theme: light. Change theme' }),
    );
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('leaves long tool results collapsed', () => {
    render(
      <Conversation
        messages={[
          {
            ...messages[2]!,
            blocks: [
              {
                type: 'tool_result',
                toolUseId: 'orphan',
                isError: false,
                text: Array.from({ length: 21 }, (_, i) => `line ${i}`).join(
                  '\n',
                ),
              },
            ],
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Show all (21 lines)' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});

it.each([
  '/',
  '/m/local/projects/project-1',
  '/m/local/projects/project-1/sessions/session-0',
  '/m/local/config',
])('renders kit skeletons while %s loads', async (path) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  open(path);
  const loading = await screen.findByRole('status', { name: 'Loading' });
  expect(loading.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
  expect(loading.querySelector('.animate-pulse')).toBeNull();
});

it('renders a kit empty state for a project without sessions', async () => {
  mockApi({
    '/api/m/local/projects/project-1': { ...projectDetail, sessions: [] },
  });
  open('/m/local/projects/project-1');
  expect(await screen.findByText('No sessions found yet.')).toBeInTheDocument();
});

it('renders kit empty states for unconfigured global config sections', async () => {
  mockApi({
    '/api/m/local/config': {
      ...globalConfig,
      skills: [],
      hooks: [],
      settings: {},
    },
  });
  open('/m/local/config');
  for (const name of [
    'No skills configured.',
    'No hooks configured.',
    'No settings configured.',
  ]) {
    expect(await screen.findByText(name)).toBeInTheDocument();
  }
});

it.each([
  [
    '/m/local/projects/project-1/sessions/session-0',
    '/m/local/projects/project-1',
    'Dashboard',
  ],
  ['/m/local/projects/project-1', '/m/local', 'Overview'],
  ['/m/local/search', '/m/local', 'Overview'],
  ['/m/local/config', '/m/local', 'Overview'],
])(
  'links from a deep link at %s to its registered parent',
  async (path, parent, label) => {
    mockApi();
    const router = open(path);
    const back = await screen.findByRole('link', { name: `Back to ${label}` });
    expect(back).toHaveAttribute('href', parent);
    expect(back).not.toHaveAttribute('aria-current');
    expect(back).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:outline-2');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const items = within(crumbs).getAllByRole('listitem');
    expect(items[0]).toHaveClass('hidden', 'sm:flex');
    expect(items.at(-1)).not.toHaveClass('hidden');
    back.focus();
    expect(back).toHaveFocus();
    fireEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe(parent));
  },
);

it('shows no back control on Overview', async () => {
  mockApi();
  open();
  await screen.findByRole('heading', { name: 'Overview' });
  expect(screen.queryByRole('link', { name: /^Back to / })).toBeNull();
});

it('round trips the Overview project filter through the URL and scopes its cost label', async () => {
  vi.spyOn(api, 'usage').mockResolvedValue({
    tz: 'UTC',
    from: '2026-10-01',
    to: '2026-10-28',
    days: [],
    byProject: [],
    byModel: [],
    cacheHit: [],
    totals: { tokens: project.tokens, costUsd: 0.25 },
  });
  mockApi();
  const router = open('/?project=project-1&range=7&status=need_input');
  const picker = await screen.findByRole('combobox', { name: 'Usage project' });
  await waitFor(() => expect(picker).toHaveTextContent('Dashboard'));
  expect(await screen.findByText('≈ $0.25 · Dashboard')).toBeInTheDocument();
  expect(
    screen.getByText(/sessions across .*workspace now/),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Session status totals are workspace-wide.'),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(api.usage).toHaveBeenLastCalledWith(
      'local',
      expect.objectContaining({ projectId: 'project-1' }),
      expect.any(AbortSignal),
    ),
  );
  picker.focus();
  fireEvent.keyDown(picker, { key: 'ArrowDown' });
  const allOption = await screen.findByRole('option', { name: 'All projects' });
  fireEvent.keyDown(allOption, { key: 'Enter' });
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      range: 7,
      status: 'need_input',
    }),
  );
  expect(router.state.location.search.project).toBeUndefined();
  expect(router.state.location.searchStr).not.toContain('project=');
  fireEvent.click(picker);
  const projectOption = await screen.findByRole('option', {
    name: 'Dashboard',
  });
  fireEvent.keyDown(projectOption, { key: 'Enter' });
  await waitFor(() =>
    expect(router.state.location.search.project).toBe('project-1'),
  );
  expect(router.state.location.searchStr).toContain('project=project-1');
  await act(async () => {
    await router.navigate({
      to: '/m/$machineId/config',
      params: { machineId: 'local' },
    });
  });
  await act(async () => {
    await router.navigate({
      to: '/m/$machineId',
      params: { machineId: 'local' },
      search: { project: 'project-1', range: 7, status: 'need_input' },
    });
  });
  expect(
    await screen.findByRole('combobox', { name: 'Usage project' }),
  ).toHaveTextContent('Dashboard');
});

it.each(['missing', '42'])(
  'falls back to all projects for unknown Overview project %s',
  async (id) => {
    const usage = vi.spyOn(api, 'usage').mockResolvedValue({
      tz: 'UTC',
      from: '2026-10-01',
      to: '2026-10-28',
      days: [],
      byProject: [],
      byModel: [],
      cacheHit: [],
      totals: { tokens: project.tokens, costUsd: 0.25 },
    });
    mockApi();
    open(`/?project=${id}`);
    expect(
      await screen.findByRole('combobox', { name: 'Usage project' }),
    ).toHaveTextContent('All projects');
    await waitFor(() =>
      expect(usage).toHaveBeenCalledWith(
        'local',
        expect.objectContaining({ projectId: '' }),
        expect.any(AbortSignal),
      ),
    );
    expect(screen.queryByText('≈ $0.25 · Dashboard')).toBeNull();
  },
);

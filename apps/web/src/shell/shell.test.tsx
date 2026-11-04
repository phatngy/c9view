import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { routeTree } from '../router.js';
import { overview, project, projectDetail } from '../test-fixtures.js';
import type { ProjectSummary } from '@c9view/api';
import { projectStatus, visibleProjects } from './ProjectNav.js';
import { resetConnection, setConnection } from '../live/state.js';
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  resetConnection();
});
function open(
  path = '/',
  pending = false,
  projects: ProjectSummary[] = [project],
  strictMode = false,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (pending && url === '/api/projects') return new Promise(() => {});
      const data =
        url === '/api/projects'
          ? { projects }
          : url === '/api/overview'
            ? overview
            : url === '/api/projects/project-1'
              ? projectDetail
              : { error: 'Unavailable' };
      return {
        ok: !('error' in data),
        status: 'error' in data ? 500 : 200,
        json: async () => data,
      };
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPendingMinMs: 0,
  });
  const app = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(strictMode ? <StrictMode>{app}</StrictMode> : app);
  return router;
}
describe('app shell', () => {
  it('shows ten recent overview projects and expands after applying the status filter', async () => {
    const projects = Array.from({ length: 12 }, (_, index) => ({
      ...project,
      id: `overview-${index}`,
      name: `Project ${index}`,
      lastActivityAt: `2026-10-${String(29 - index).padStart(2, '0')}T00:00:00Z`,
      columns:
        index === 11
          ? { inactive: 0, need_input: 0, in_progress: 2, in_review: 0 }
          : index === 0
            ? { inactive: 0, need_input: 1, in_progress: 2, in_review: 3 }
            : { inactive: 0, need_input: 1, in_progress: 0, in_review: 0 },
    }));
    open('/', false, projects);
    const table = await screen.findByRole('region', { name: 'Projects table' });
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .every((header) => header.getAttribute('scope') === 'col'),
    ).toBe(true);
    const firstStatusCell = within(table).getAllByRole('row')[1]!.children[1]!;
    expect(firstStatusCell).toHaveTextContent(
      /Need input\s*1.*In progress\s*2.*In review\s*3/,
    );
    expect(firstStatusCell).not.toHaveTextContent('Inactive');
    const statusButtons = within(
      screen.getByRole('group', { name: 'Filter projects by status' }),
    ).getAllByRole('button');
    expect(statusButtons.map((button) => button.textContent?.trim())).toEqual([
      'Need input1',
      'In progress1',
      'In review1',
      'Inactive1',
    ]);
    expect(
      within(table).getByRole('button', { name: 'Show all 12 projects' }),
    ).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Show all 12 projects' }),
    );
    expect(within(table).getAllByRole('row')).toHaveLength(13);

    fireEvent.click(screen.getByRole('button', { name: /Need input/ }));
    expect(
      await within(table).findByRole('button', {
        name: 'Show all 11 projects',
      }),
    ).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Show all 11 projects' }),
    );
    expect(within(table).getAllByRole('row')).toHaveLength(12);
    expect(within(table).queryByText('In progress 0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Need input/ }));
    expect(
      await within(table).findByRole('button', {
        name: 'Show all 12 projects',
      }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    fireEvent.click(
      within(table).getByRole('button', { name: 'Show all 12 projects' }),
    );
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search projects' }),
      {
        target: { value: 'Project' },
      },
    );
    expect(
      await within(table).findByRole('button', {
        name: 'Show all 12 projects',
      }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
  });

  it('keeps list headers and numeric columns aligned, with model badges unwrapped', async () => {
    open('/projects/project-1?view=list');
    const table = await screen.findByRole('region', { name: 'Sessions table' });
    for (const label of ['Messages', 'Tokens', '≈ Cost']) {
      const header = within(table).getByRole('button', {
        name: new RegExp(label),
      });
      expect(header).toHaveClass('whitespace-nowrap');
      expect(header.closest('th')).toHaveClass('text-right');
      expect(header.closest('th')).toHaveAttribute('aria-sort');
      expect(header).toHaveClass('justify-end');
      expect(header.querySelector('svg')).toBeTruthy();
      expect(header.querySelector('svg')!.previousSibling).toHaveTextContent(
        label,
      );
    }
    const messagesHeader = within(table).getByRole('columnheader', {
      name: /Messages/,
    });
    expect(messagesHeader).toHaveClass('text-right');
    expect(messagesHeader).toHaveAttribute('aria-sort', 'none');
    const numericCell =
      within(table).getAllByRole('row')[1]!.children[
        (messagesHeader as HTMLTableCellElement).cellIndex
      ]!;
    expect(numericCell).toHaveClass('text-right', 'tabular-nums');
    expect(
      table.querySelector(
        '.project-list tbody td:nth-child(3) span.whitespace-nowrap',
      ),
    ).toBeTruthy();
  });

  it('shows muted folder hints for duplicate names in Overview', async () => {
    const duplicate = {
      ...project,
      id: 'project-2',
      path: '/personal/dashboard',
    };
    open('/', false, [project, duplicate]);
    const table = await screen.findByRole('region', { name: 'Projects table' });
    expect(within(table).getByText('workspace')).toHaveClass('text-muted');
    expect(within(table).getByText('workspace')).toHaveAttribute(
      'title',
      'project-1',
    );
    expect(within(table).getByText('personal')).toHaveClass('text-muted');
  });

  it('shows the selected project folder hint in navigation and breadcrumbs', async () => {
    const duplicate = {
      ...project,
      id: 'project-2',
      path: '/personal/dashboard',
    };
    open('/projects/project-1', false, [project, duplicate]);
    const projectNav = await screen.findByRole('navigation', {
      name: 'Projects',
    });
    expect(
      await within(projectNav).findByRole('link', {
        name: 'Dashboard, workspace, 1 need input',
      }),
    ).toBeInTheDocument();
    const breadcrumb = await screen.findByRole('navigation', {
      name: 'Breadcrumb',
    });
    expect(within(breadcrumb).getByText('workspace')).toHaveClass('text-muted');
    const primaryName = projectNav.querySelector('.shell-truncate');
    const hint = within(projectNav).getByText('workspace');
    expect(primaryName).toHaveClass('shrink-0', 'max-w-[70%]', 'truncate');
    expect(hint).toHaveClass('min-w-0', 'truncate');
    expect(hint.parentElement).toHaveClass(
      'flex',
      'min-w-0',
      'items-baseline',
      'text-xs',
      'text-muted',
    );
    expect(hint.parentElement).toHaveAttribute('title', 'project-1');
    expect(primaryName).toHaveTextContent('Dashboard');
    expect(within(breadcrumb).getByText('workspace')).toHaveAttribute(
      'title',
      'project-1',
    );
  });

  it('keeps duplicate project ordinals visible when sidebar hints truncate', async () => {
    const projects = [
      {
        ...project,
        id: 'duplicate-a',
        name: 'website-cloner',
        path: '/home/user/github/personal/website-cloner',
      },
      {
        ...project,
        id: 'duplicate-b',
        name: 'website-cloner',
        path: '/home/user/github/personal/website-cloner',
      },
    ];
    open('/', false, projects);
    const nav = await screen.findByRole('navigation', { name: 'Projects' });
    const first = await within(nav).findByRole('link', {
      name: 'website-cloner, …/github/personal #1, 1 need input',
    });
    const second = within(nav).getByRole('link', {
      name: 'website-cloner, …/github/personal #2, 1 need input',
    });
    for (const [row, ordinal] of [
      [first, '#1'],
      [second, '#2'],
    ] as const) {
      const ordinalElement = within(row).getByText(ordinal);
      expect(ordinalElement).toHaveClass('shrink-0');
      expect(ordinalElement.parentElement).toHaveAttribute(
        'title',
        row === first ? 'duplicate-a' : 'duplicate-b',
      );
      expect(ordinalElement.parentElement?.firstElementChild).toHaveClass(
        'min-w-0',
        'truncate',
      );
    }
  });

  it('keeps session breadcrumbs and the project hint registered in StrictMode', async () => {
    const duplicate = {
      ...project,
      id: 'project-2',
      path: '/personal/dashboard',
    };
    open(
      '/projects/project-1/sessions/session-0',
      false,
      [project, duplicate],
      true,
    );
    const breadcrumb = await screen.findByRole('navigation', {
      name: 'Breadcrumb',
    });
    expect(within(breadcrumb).getByText('Dashboard')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('workspace')).toHaveAttribute(
      'title',
      'project-1',
    );
  });

  it('keeps the project count visible beside a long name and hint', async () => {
    const longName =
      'A very long project name that should not crowd its count badge';
    const named = {
      ...project,
      name: longName,
      path: '/workspace/long-project',
    };
    const duplicate = {
      ...project,
      id: 'project-2',
      name: longName,
      path: '/personal/long-project',
    };
    open('/', false, [named, duplicate]);
    const projectNav = await screen.findByRole('navigation', {
      name: 'Projects',
    });
    const link = await within(projectNav).findByRole('link', {
      name: `${longName}, workspace, 1 need input`,
    });
    const name = link.querySelector('.shell-truncate');
    const count = link.querySelector('.shell-project-count');
    expect(name).not.toHaveClass('flex-1');
    expect(count).toHaveTextContent('1');
    expect(count).toHaveClass('shell-project-count', 'shrink-0');
  });

  it('does not show a folder hint for a unique project name', async () => {
    open('/projects/project-1', false, [project]);
    const projectNav = await screen.findByRole('navigation', {
      name: 'Projects',
    });
    expect(
      await within(projectNav).findByRole('link', {
        name: 'Dashboard, 1 need input',
      }),
    ).toBeInTheDocument();
    expect(within(projectNav).queryByText('workspace')).not.toBeInTheDocument();
  });

  it('includes duplicate name hints in collapsed project tooltips', async () => {
    localStorage.setItem('c9view-sidebar', 'collapsed');
    const duplicate = {
      ...project,
      id: 'project-2',
      path: '/personal/dashboard',
    };
    open('/', false, [project, duplicate]);
    const projectRow = await screen.findByRole('link', {
      name: 'Dashboard, workspace, 1 need input',
    });
    projectRow.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Dashboard · workspace · 1 need input',
    );
  });

  it('puts duplicate project hints on the project crumb on session pages', async () => {
    const duplicate = {
      ...project,
      id: 'project-2',
      path: '/personal/dashboard',
    };
    open('/projects/project-1/sessions/session-0', false, [project, duplicate]);
    const breadcrumb = await screen.findByRole('navigation', {
      name: 'Breadcrumb',
    });
    await within(breadcrumb).findByText('Session');
    const items = within(breadcrumb).getAllByRole('listitem');
    expect(within(items[1]!).getByText('workspace')).toHaveClass('text-muted');
    expect(within(items[2]!).getByText('Session')).toBeInTheDocument();
    expect(within(items[2]!).queryByText('workspace')).not.toBeInTheDocument();
  });

  it('keeps eight recent projects plus the current project and selects urgency independently of counts', () => {
    const projects = Array.from({ length: 10 }, (_, i) => ({
      ...project,
      id: `p${i}`,
      lastActivityAt: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    expect(visibleProjects(projects, 'p0').map((p) => p.id)).toEqual([
      'p9',
      'p8',
      'p7',
      'p6',
      'p5',
      'p4',
      'p3',
      'p2',
      'p0',
    ]);
    expect(
      projectStatus({
        ...project,
        columns: { inactive: 10, need_input: 1, in_progress: 4, in_review: 7 },
      }),
    ).toBe('need_input');
    expect(
      projectStatus({
        ...project,
        columns: { inactive: 10, need_input: 0, in_progress: 4, in_review: 7 },
      }),
    ).toBe('in_progress');
    expect(
      projectStatus({
        ...project,
        columns: { inactive: 10, need_input: 0, in_progress: 0, in_review: 7 },
      }),
    ).toBe('in_review');
  });
  it('persists collapse, keeps labeled icon links, and expands for command search', async () => {
    open();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Collapse sidebar' }),
    );
    expect(localStorage.getItem('c9view-sidebar')).toBe('collapsed');
    expect(
      within(
        screen.getByRole('navigation', { name: 'Main navigation' }),
      ).getByRole('link', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByLabelText('Search all conversations')).toHaveFocus(),
    );
    expect(localStorage.getItem('c9view-sidebar')).toBe('expanded');
  });
  it('restores collapse and tolerates unavailable storage', async () => {
    localStorage.setItem('c9view-sidebar', 'collapsed');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    open();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Expand sidebar' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Collapse sidebar' }),
    ).toBeInTheDocument();
  });
  it('renders a project skeleton before the request resolves', async () => {
    open('/', true);
    expect(
      await screen.findByRole('status', { name: 'Loading projects' }),
    ).toBeInTheDocument();
  });
  it('shows current sessions by urgency and retains the API cost anchor', async () => {
    open('/projects/project-1');
    const nav = await screen.findByRole('navigation', { name: 'Projects' });
    await within(nav).findByRole('link', { name: 'All 4 sessions' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Dashboard1',
      'Task need_input',
      'Task in_progress',
      'Task in_review',
      'All 4 sessions',
      'Show all projects',
    ]);
    expect(
      within(nav).getByRole('link', { name: 'Dashboard, 1 need input' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(document.querySelectorAll('#api-equivalent-cost')).toHaveLength(1);
    expect(document.getElementById('api-equivalent-cost')).toHaveTextContent(
      'Estimated at API list prices; not your actual bill on a subscription plan.',
    );
  });
  it('marks the current session row, rather than its project row, on session routes', async () => {
    open('/projects/project-1/sessions/session-1');
    await waitFor(() =>
      expect(document.documentElement).toHaveClass('session-route'),
    );
    const nav = await screen.findByRole('navigation', { name: 'Projects' });
    const projectRow = await within(nav).findByRole('link', {
      name: 'Dashboard, 1 need input',
    });
    const sessionRow = await within(nav).findByRole('link', {
      name: 'Task need_input',
    });
    expect(projectRow).toHaveAttribute('data-current', 'true');
    expect(projectRow).not.toHaveAttribute('aria-current');
    expect(sessionRow).toHaveAttribute('aria-current', 'page');
    const cost = document.getElementById('api-equivalent-cost');
    expect(cost).toBeInTheDocument();
    expect(cost?.closest('footer')).toHaveClass('shell-page-footer');
    expect(getComputedStyle(cost!.closest('footer')!).display).not.toBe('none');
  });

  it('renders an inactive project with a hollow dot and no numeric badge', async () => {
    open('/', false, [
      {
        ...project,
        name: 'Quiet project',
        columns: { inactive: 20, need_input: 0, in_progress: 0, in_review: 0 },
      },
    ]);
    const row = await screen.findByRole('link', {
      name: 'Quiet project, Inactive',
    });
    expect(row.querySelector('.shell-status-dot')).toHaveAttribute(
      'data-column',
      'inactive',
    );
    expect(row.querySelector('.shell-project-count')).toBeNull();
    expect(row).toHaveTextContent('Quiet project');
  });
  it('renders an older current project after the eight most recent projects', async () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({
      ...project,
      id: `recent-${i}`,
      name: `Recent ${i}`,
      lastActivityAt: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    open('/projects/project-1', false, [
      ...recent,
      { ...project, lastActivityAt: null },
    ]);
    const nav = await screen.findByRole('navigation', { name: 'Projects' });
    const selected = await within(nav).findByRole('link', {
      name: 'Dashboard, 1 need input',
    });
    expect(selected).toHaveAttribute('aria-current', 'page');
    const projectRows = Array.from(nav.querySelectorAll('.shell-nav-link'));
    expect(projectRows).toHaveLength(9);
    expect(projectRows.at(-1)).toBe(selected);
    expect(projectRows[0]).toHaveTextContent('Recent 9');
    expect(
      within(nav).queryByRole('link', { name: 'Recent 0, 1 need input' }),
    ).not.toBeInTheDocument();
  });
  it('opens a modal drawer, focuses close, closes on Escape and restores trigger focus', async () => {
    open();
    const trigger = await screen.findByRole('button', {
      name: 'Open navigation',
    });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Close navigation' }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('closes the drawer when the desktop breakpoint starts matching', async () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return matches;
        },
        addEventListener: (_type: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
      })),
    );
    open();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open navigation' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Navigation' }),
    ).toBeInTheDocument();
    matches = true;
    listeners.forEach((listener) => listener());
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    cleanup();
    expect(listeners.size).toBe(0);
  });
  it.each([
    ['live', 'Live', () => setConnection('live')],
    ['connecting', 'Connecting…', () => setConnection('connecting')],
    ['offline polling', 'Offline · polling', () => resetConnection()],
    [
      'offline',
      'Offline',
      () => {
        setConnection('live');
        setConnection('offline');
      },
    ],
  ])(
    'exposes the visible connection label for %s',
    async (_state, label, setState) => {
      setState();
      open();
      expect(
        await screen.findByRole('status', { name: label }),
      ).toHaveTextContent(label);
    },
  );
  it('shows status details in collapsed project tooltips without native titles', async () => {
    localStorage.setItem('c9view-sidebar', 'collapsed');
    open();
    const projectRow = await screen.findByRole('link', {
      name: 'Dashboard, 1 need input',
    });
    expect(projectRow).not.toHaveAttribute('title');
    expect(projectRow).not.toHaveAttribute('aria-describedby');
    projectRow.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Dashboard · 1 need input',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    await waitFor(() =>
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
    );
  });
  it('shows only the project name in an inactive collapsed tooltip', async () => {
    localStorage.setItem('c9view-sidebar', 'collapsed');
    open('/', false, [
      {
        ...project,
        name: 'Quiet project',
        columns: { inactive: 20, need_input: 0, in_progress: 0, in_review: 0 },
      },
    ]);
    const row = await screen.findByRole('link', {
      name: 'Quiet project, Inactive',
    });
    row.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Quiet project',
    );
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Inactive');
  });
  it('closes the mobile drawer after navigation', async () => {
    open();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open navigation' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    fireEvent.click(within(dialog).getByRole('link', { name: 'Search' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText('Enter a query to search conversations.'),
    ).toBeInTheDocument();
  });
});

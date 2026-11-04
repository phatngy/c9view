import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../api.js', () => ({ useProjects: () => ({ data: undefined }) }));
import { BreadcrumbProvider, useBreadcrumbs } from './breadcrumbs.js';
import { TopBar } from './TopBar.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function Registration({ label }: { label: string }) {
  useBreadcrumbs([{ label: 'Projects', to: '/projects' }, { label }]);
  return null;
}
function Harness() {
  const [label, setLabel] = useState('Project alpha');
  const [registered, setRegistered] = useState(true);
  return (
    <BreadcrumbProvider>
      <TopBar menuButton={null} />
      {registered && <Registration label={label} />}
      <button onClick={() => setLabel('Project beta')}>Rename</button>
      <button onClick={() => setRegistered(false)}>Leave project</button>
    </BreadcrumbProvider>
  );
}

it('registers ordered breadcrumbs, updates their labels, and cleans up on unmount', async () => {
  const router = createRouter({
    routeTree: createRootRoute({ component: Harness }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText('Project alpha');
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const list = within(nav).getByRole('list');
  expect(list.tagName).toBe('OL');
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(
    within(items[0]!).getByRole('link', { name: 'Projects' }),
  ).toHaveAttribute('href', '/projects');
  expect(within(items[1]!).getByText('Project alpha')).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  expect(await within(nav).findByText('Project beta')).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).queryByText('Project alpha')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Leave project' }));
  expect(await within(nav).findByText('Overview')).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(within(nav).queryByText('Projects')).not.toBeInTheDocument();
  expect(within(nav).queryByText('Project beta')).not.toBeInTheDocument();
});

it('marks only the last breadcrumb current when an ancestor link matches the route', async () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <BreadcrumbProvider>
          <TopBar menuButton={null} />
          <Registration label="Session one" />
        </BreadcrumbProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/projects/alpha'] }),
  });
  render(<RouterProvider router={router} />);
  const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
  await within(nav).findByText('Session one');
  expect(
    within(nav).getByRole('link', { name: 'Projects' }),
  ).not.toHaveAttribute('aria-current');
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});

it('renders no fallback breadcrumb outside the exact overview route', () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <TopBar menuButton={null} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/config'] }),
  });
  render(<RouterProvider router={router} />);
  expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
});

it.each(['/search', '/config'])(
  'uses the route parent for %s without depending on the page label',
  async (path) => {
    function Page() {
      // Even an Overview label must not change these routes' parent.
      useBreadcrumbs([{ label: 'Overview' }]);
      return null;
    }
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <BreadcrumbProvider>
            <TopBar menuButton={null} />
            <Page />
          </BreadcrumbProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    render(<RouterProvider router={router} />);
    const back = await screen.findByRole('link', { name: 'Back to Overview' });
    expect(back).toHaveAttribute('href', '/');
    expect(back).not.toHaveAttribute('aria-current');
    fireEvent.click(back);
    await screen.findByText('Overview', { selector: '[aria-current="page"]' });
    expect(router.state.location.pathname).toBe('/');
  },
);

it.each(['…', ''])(
  'gives placeholder project label %j a readable back name',
  async (label) => {
    function Page() {
      useBreadcrumbs([
        { label: 'Overview', to: '/' },
        { label, textLabel: label, to: '/projects/alpha' },
        { label: 'Session' },
      ]);
      return null;
    }
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <BreadcrumbProvider>
            <TopBar menuButton={null} />
            <Page />
          </BreadcrumbProvider>
        ),
      }),
      history: createMemoryHistory({
        initialEntries: ['/projects/alpha/sessions/one'],
      }),
    });
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole('link', { name: 'Back to project' }),
    ).toHaveAttribute('href', '/projects/alpha');
  },
);

it('hides a stale back link once its destination is the current URL', async () => {
  function Page() {
    useBreadcrumbs([{ label: 'Overview', to: '/' }, { label: 'Project' }]);
    return null;
  }
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <BreadcrumbProvider>
          <TopBar menuButton={null} />
          <Page />
        </BreadcrumbProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText('Project');
  expect(screen.queryByRole('link', { name: 'Back to Overview' })).toBeNull();
});

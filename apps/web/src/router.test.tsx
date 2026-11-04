import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { expect, it } from 'vitest';
import { routeTree } from './router.js';

it.each([
  '/',
  '/m',
  '/m/',
  '/config',
  '/search',
  '/projects/p',
  '/projects/p/sessions/s',
])('redirects legacy %s preserving the path and query', async (path) => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`${path}?q=hello%20world&extra=kept`],
    }),
  });
  await router.load();
  expect(router.state.location.pathname).toBe(
    `/m/local${['/', '/m', '/m/'].includes(path) ? '' : path}`,
  );
  expect(router.state.location.search).toMatchObject({
    q: 'hello world',
    extra: 'kept',
  });
});

it('keeps navigation, requests and cache entries on the selected remote machine', async () => {
  const { render, screen, cleanup } = await import('@testing-library/react');
  const { QueryClient, QueryClientProvider } =
    await import('@tanstack/react-query');
  const { RouterProvider } = await import('@tanstack/react-router');
  const { api } = await import('./api.js');
  const { overview, projectDetail } = await import('./test-fixtures.js');
  const { vi } = await import('vitest');
  await import('./search/SearchPage.js');
  vi.spyOn(api, 'overview').mockResolvedValue(overview);
  vi.spyOn(api, 'projects').mockResolvedValue({
    projects: [projectDetail.project],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/m/remote/search'] }),
    defaultPendingMinMs: 0,
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', { name: 'Search conversations' });
    expect(
      screen.getAllByRole('link', { name: 'Overview' })[0],
    ).toHaveAttribute('href', '/m/remote');
    expect(api.projects).toHaveBeenCalledWith(
      'remote',
      expect.any(AbortSignal),
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[0] === 'remote'),
    ).toBe(true);
  } finally {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  }
});

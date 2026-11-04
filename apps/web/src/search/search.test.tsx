import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { routeTree } from '../router.js';
import { api } from '../api.js';
import { overview, project, projectDetail } from '../test-fixtures.js';
import { Highlights } from './highlights.js';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it.each([
  {
    text: 'abcdef',
    ranges: [
      [0, 2],
      [1, 4],
      [4, 6],
    ],
    marks: ['abcdef'],
  },
  {
    text: 'abcdef',
    ranges: [
      [4, 6],
      [0, 1],
    ],
    marks: ['a', 'ef'],
  },
  { text: '<script>safe</script>', ranges: [[0, 8]], marks: ['<script>'] },
  {
    text: 'abcdef',
    ranges: [
      [-4, 2],
      [4, 90],
      [3, 3],
      [8, 9],
    ],
    marks: ['ab', 'ef'],
  },
  { text: 'abcdef', ranges: [], marks: [] },
])('renders safe merged highlights: $ranges', ({ text, ranges, marks }) => {
  const { container } = render(
    <Highlights text={text} ranges={ranges as [number, number][]} />,
  );
  expect(container.textContent).toBe(text);
  expect(
    [...container.querySelectorAll('mark')].map((mark) => mark.textContent),
  ).toEqual(marks);
  expect(container.querySelector('script')).toBeNull();
});
function open(path = '/search?q=hello', listsPending = false) {
  vi.spyOn(api, 'projects').mockImplementation(() =>
    listsPending
      ? new Promise(() => {})
      : Promise.resolve({ projects: [project] }),
  );
  vi.spyOn(api, 'overview').mockImplementation(() =>
    listsPending ? new Promise(() => {}) : Promise.resolve(overview),
  );
  vi.spyOn(api, 'project').mockResolvedValue(projectDetail);
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
it('keeps project, date and model filters in the shareable URL and debounces typing', async () => {
  const search = vi
    .spyOn(api, 'search')
    .mockResolvedValue({ results: [], nextCursor: null });
  const router = open();
  await screen.findByText('No results match your search.');
  fireEvent.click(screen.getByRole('combobox', { name: 'Project' }));
  const projectOption = await screen.findByRole('option', {
    name: project.name,
  });
  fireEvent.pointerDown(projectOption, { pointerType: 'mouse' });
  fireEvent.click(projectOption);
  await waitFor(() =>
    expect(router.state.location.search.projectId).toBe(project.id),
  );
  fireEvent.change(screen.getByLabelText('From'), {
    target: { value: '2026-01-01' },
  });
  await waitFor(() =>
    expect(router.state.location.search.from).toBe('2026-01-01'),
  );
  fireEvent.change(screen.getByLabelText('To'), {
    target: { value: '2026-12-31' },
  });
  await waitFor(() =>
    expect(router.state.location.search.to).toBe('2026-12-31'),
  );
  const model = screen.getByRole('combobox', { name: 'Model' });
  model.focus();
  fireEvent.keyDown(model, { key: 'ArrowDown' });
  const modelOption = await screen.findByRole('option', {
    name: 'claude-sonnet',
  });
  fireEvent.pointerDown(modelOption, { pointerType: 'mouse' });
  fireEvent.click(modelOption);
  await waitFor(() =>
    expect(router.state.location.search.model).toBe('claude-sonnet'),
  );
  search.mockClear();
  fireEvent.change(screen.getByLabelText('Search query'), {
    target: { value: 'new query' },
  });
  expect(router.state.location.search.q).toBe('hello');
  expect(search).not.toHaveBeenCalled();
  await waitFor(() => expect(router.state.location.search.q).toBe('new query'));
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({
      q: 'new query',
      projectId: project.id,
      model: 'claude-sonnet',
    }),
    null,
    expect.any(AbortSignal),
  );
});
it('restores the query draft when browser back returns to an earlier query', async () => {
  vi.spyOn(api, 'search').mockResolvedValue({ results: [], nextCursor: null });
  const router = open('/search?q=a');
  await screen.findByText('No results match your search.');
  const input = screen.getByLabelText('Search query');

  // Updating another filter with the current query must not leave a stale
  // marker that can suppress a later browser navigation to the same query.
  fireEvent.click(screen.getByRole('combobox', { name: 'Project' }));
  const projectOption = await screen.findByRole('option', {
    name: project.name,
  });
  fireEvent.pointerDown(projectOption, { pointerType: 'mouse' });
  fireEvent.click(projectOption);
  await waitFor(() =>
    expect(router.state.location.search.projectId).toBe(project.id),
  );
  await act(async () => router.history.push('/search?q=b'));
  await waitFor(() => expect(input).toHaveValue('b'));

  await act(async () => {
    router.history.back();
  });
  await waitFor(() => expect(router.state.location.search.q).toBe('a'));
  expect(input).toHaveValue('a');
});
it('keeps newer draft text when an earlier debounced URL update commits', async () => {
  vi.spyOn(api, 'search').mockResolvedValue({ results: [], nextCursor: null });
  const router = open();
  await screen.findByText('No results match your search.');
  vi.useFakeTimers();
  const input = screen.getByLabelText('Search query');
  fireEvent.change(input, { target: { value: 'first' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.change(input, { target: { value: 'first plus' } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(router.state.location.search.q).toBe('first');
  expect(input).toHaveValue('first plus');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(router.state.location.search.q).toBe('first plus');
  expect(input).toHaveValue('first plus');
});
it('shows indexing progress for a 503', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Search is available once indexing finishes',
          }),
          { status: 503 },
        ),
    ),
  );
  vi.spyOn(api, 'health').mockResolvedValue({
    ok: true,
    version: 'test',
    claudeDir: '',
    index: {
      state: 'building',
      progress: { completed: 2, total: 5 },
      lastFullScanAt: null,
    },
  });
  open();
  expect(
    await screen.findByText('Search is available once indexing finishes'),
  ).toBeInTheDocument();
  expect(await screen.findByText('Indexed 2 of 5')).toBeInTheDocument();
});
it('loads another cursor page, groups results and links to message anchors', async () => {
  const row = {
    projectId: project.id,
    sessionId: 'session-0',
    messageUuid: 'message-1',
    timestamp: '2026-01-01T12:00:00Z',
    role: 'user',
    model: 'claude-sonnet',
    snippet: ' hello world.',
    highlights: [[0, 5]] as [number, number][],
  };
  const search = vi
    .spyOn(api, 'search')
    .mockResolvedValueOnce({ results: [row], nextCursor: '50' })
    .mockResolvedValueOnce({
      results: [{ ...row, messageUuid: 'message-2', snippet: ' hello again.' }],
      nextCursor: null,
    });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect(
    await screen.findByText('again', { exact: false }),
  ).toBeInTheDocument();
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ q: 'hello' }),
    '50',
    expect.any(AbortSignal),
  );
  await screen.findByRole('heading', {
    name: 'Dashboard · Task inactive · 2 hits',
  });
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: /hello world/ })).toHaveAttribute(
    'href',
    '/projects/project-1/sessions/session-0#m-message-1',
  );
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});
it('has an empty query state and focuses global search with slash unless typing', async () => {
  const search = vi.spyOn(api, 'search');
  const router = open('/search');
  await screen.findByText('Enter a query to search conversations.');
  expect(search).not.toHaveBeenCalled();
  const top = screen.getByLabelText('Search all conversations');
  fireEvent.keyDown(window, { key: '/' });
  expect(top).toHaveFocus();
  const query = screen.getByLabelText('Search query');
  query.focus();
  fireEvent.keyDown(query, { key: '/' });
  expect(query).toHaveFocus();
  fireEvent.change(top, { target: { value: 'find me' } });
  search.mockResolvedValue({ results: [], nextCursor: null });
  fireEvent.submit(top.closest('form')!);
  await waitFor(() => expect(router.state.location.search.q).toBe('find me'));
});
it('does not steal slash focus from an input or textarea', async () => {
  open('/search');
  await screen.findByText('Enter a query to search conversations.');
  const input = document.createElement('input');
  const textarea = document.createElement('textarea');
  document.body.append(input, textarea);
  input.focus();
  fireEvent.keyDown(input, { key: '/' });
  expect(input).toHaveFocus();
  textarea.focus();
  fireEvent.keyDown(textarea, { key: '/' });
  expect(textarea).toHaveFocus();
  input.remove();
  textarea.remove();
});
it('ignores shifted command shortcuts and slash inside an open dialog', async () => {
  open('/search');
  await screen.findByText('Enter a query to search conversations.');
  const top = screen.getByLabelText('Search all conversations');
  top.blur();
  const shifted = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(shifted);
  expect(shifted.defaultPrevented).toBe(false);
  expect(top).not.toHaveFocus();

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const button = document.createElement('button');
  dialog.append(button);
  document.body.append(dialog);
  button.focus();
  fireEvent.keyDown(button, { key: '/' });
  expect(button).toHaveFocus();
  expect(top).not.toHaveFocus();
  dialog.remove();
});

it('shows kit skeletons while searching, then a kit empty state', async () => {
  let resolveSearch!: (value: { results: []; nextCursor: null }) => void;
  vi.spyOn(api, 'search').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
  );
  open();
  const loading = await screen.findByRole('status', { name: 'Loading' });
  expect(loading.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
  await act(async () => resolveSearch({ results: [], nextCursor: null }));
  expect(
    await screen.findByText('No results match your search.'),
  ).toBeInTheDocument();
});

it('shows all-filter labels and clears selected filters in the URL', async () => {
  vi.spyOn(api, 'search').mockResolvedValue({ results: [], nextCursor: null });
  const router = open(
    '/search?q=hello&projectId=project-1&model=claude-sonnet',
  );
  await screen.findByText('No results match your search.');
  for (const [label, optionName, key] of [
    ['Project', 'All projects', 'projectId'],
    ['Model', 'All models', 'model'],
  ] as const) {
    const trigger = screen.getByRole('combobox', { name: label });
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: optionName });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() => expect(router.state.location.search[key]).toBe(''));
    expect(trigger).toHaveTextContent(optionName);
  }
});

it('labels search filters and keeps deep-linked values selected while lists load', async () => {
  open('/search?q=hello&projectId=deep-project&model=deep-model', true);
  await screen.findByText('Search conversations');
  const projectFilter = screen.getByRole('combobox', { name: 'Project' });
  const modelFilter = screen.getByRole('combobox', { name: 'Model' });
  expect(projectFilter).toHaveTextContent('Selected project');
  expect(modelFilter).toHaveTextContent('Selected model');
  expect(projectFilter).not.toHaveTextContent('Select…');
  expect(modelFilter).not.toHaveTextContent('Select…');
});

it('renders cleaned flat hits and omits the model when it is null', async () => {
  vi.spyOn(api, 'search').mockResolvedValue({
    results: [
      {
        projectId: project.id,
        sessionId: 'session-0',
        messageUuid: 'message-clean',
        timestamp: new Date().toISOString(),
        role: 'user',
        model: null,
        snippet: '<status>Hello world.</status>',
        highlights: [[8, 13]],
      },
    ],
    nextCursor: null,
  });
  open();
  const hit = await screen.findByRole('link', { name: /Hello world/ });
  expect(hit.querySelector('mark')).toHaveTextContent('Hello');
  expect(hit.querySelector('p')).toHaveTextContent(/^user · /);
  expect(hit).not.toHaveTextContent('Unknown model');
  expect(hit).not.toHaveTextContent('<status>');
  expect(hit).toHaveClass('border-t', 'min-h-11');
  expect(hit).not.toHaveClass('rounded', 'border');
  await screen.findByRole('heading', {
    name: 'Dashboard · Task inactive · 1 hit',
  });
  hit.focus();
  expect(hit).toHaveFocus();
});

it.each([null, ''])(
  'omits an empty model (%s) and hides empty snippets',
  async (model) => {
    vi.spyOn(api, 'search').mockResolvedValue({
      results: ['', '<status></status>', 'partial'].map((snippet, index) => ({
        projectId: project.id,
        sessionId: 'session-0',
        messageUuid: `empty-${index}`,
        timestamp: new Date().toISOString(),
        role: 'user',
        model,
        snippet,
        highlights: [],
        cutStart: true,
        cutEnd: true,
      })),
      nextCursor: null,
    });
    open();
    await screen.findByRole('heading', { name: /3 hits/ });
    const hits = [...document.querySelectorAll('a[href*="#m-empty-"]')];
    expect(hits).toHaveLength(3);
    for (const hit of hits) {
      expect(hit.querySelectorAll('p')).toHaveLength(1);
      expect(hit.textContent?.match(/ · /g)).toHaveLength(1);
      expect(hit).not.toHaveTextContent('…');
    }
  },
);

it('renders cut indicators visually but excludes them from the accessible link name', async () => {
  vi.spyOn(api, 'search').mockResolvedValue({
    results: [
      {
        projectId: project.id,
        sessionId: 'session-0',
        messageUuid: 'cut',
        timestamp: null,
        role: 'user',
        model: null,
        snippet: 'hello world',
        highlights: [
          [0, 5],
          [6, 11],
        ],
        cutStart: true,
        cutEnd: true,
      },
    ],
    nextCursor: null,
  });
  open();
  const hit = await screen.findByRole('link', { name: /hello world/ });
  expect(hit.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2);
  expect(hit).toHaveAccessibleName(/hello world$/);
  expect(hit).toHaveTextContent('…hello world…');
});

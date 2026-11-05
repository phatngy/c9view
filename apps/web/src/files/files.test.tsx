import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FileContentResponse,
  FileListResponse,
  GitDiffResponse,
  GitStatusResponse,
  SessionChangesResponse,
  SessionFileDiffResponse,
} from '@c9view/api';
import { FileTree } from './FileTree.js';
import { FileViewer } from './FileViewer.js';
import { ProjectChanges } from './ProjectChanges.js';
import { ProjectFiles } from './ProjectFiles.js';
import { SessionChanges } from './SessionChanges.js';
import type { ReactNode } from 'react';
vi.mock('../diff/highlight.js', () => ({
  CodeLine: ({ text }: { text: string }) => <code>{text}</code>,
  languageFor: () => 'text',
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname,
  );
});
function open(element: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
}
type Response =
  | FileListResponse
  | FileContentResponse
  | GitDiffResponse
  | GitStatusResponse
  | SessionChangesResponse
  | SessionFileDiffResponse;
function mock(responses: Record<string, Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: url in responses,
      status: url in responses ? 200 : 404,
      json: async () => responses[url] ?? { error: 'Project not found' },
    })),
  );
}
const base = '/api/m/local/projects/p';
const file: FileContentResponse = {
  path: 'src/demo.ts',
  size: 30,
  language: 'typescript',
  binary: false,
  tooLarge: false,
  content: 'first\nsecond\nthird',
};
const status: GitStatusResponse = {
  isRepo: true,
  branch: 'feature',
  ahead: 1,
  behind: 2,
  files: [{ path: 'demo.ts', status: 'modified', index: ' ', worktree: 'M' }],
};
const patch: GitDiffResponse = {
  isRepo: true,
  files: [
    {
      oldPath: 'demo.ts',
      path: 'demo.ts',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-before', '+after'],
        },
      ],
    },
  ],
};
describe('files and changes', () => {
  it('lazily expands directories, navigates with keyboard, and reveals denied reasons on focus', async () => {
    mock({
      [`${base}/files?path=`]: {
        path: '',
        entries: [
          { name: 'src', path: 'src', type: 'dir' },
          {
            name: '.env',
            path: '.env',
            type: 'file',
            denied: true,
            reason: 'Secret file policy',
          },
        ],
      },
      [`${base}/files?path=src`]: {
        path: 'src',
        entries: [{ name: 'demo.ts', path: 'src/demo.ts', type: 'file' }],
      },
    });
    const onOpen = vi.fn();
    open(<FileTree projectId="p" onOpen={onOpen} />);
    const dir = await screen.findByRole('button', { name: /src/ });
    expect(fetch).not.toHaveBeenCalledWith(
      `${base}/files?path=src`,
      expect.anything(),
    );
    fireEvent.click(dir);
    const leaf = await screen.findByRole('button', { name: /demo.ts/ });
    expect(sessionStorage.getItem('c9view-tree-p')).toContain('src');
    dir.focus();
    fireEvent.keyDown(dir, { key: 'ArrowDown' });
    expect(leaf).toHaveFocus();
    fireEvent.click(leaf);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/demo.ts' }),
    );
    const denied = screen.getByRole('button', { name: /\.env/ });
    fireEvent.focus(denied);
    expect(screen.getByRole('note')).toHaveTextContent('Secret file policy');
    expect(denied).toHaveAccessibleDescription('Secret file policy');
  });
  it('shows binary and large-file notices without content', () => {
    const { rerender } = render(
      <FileViewer file={{ ...file, binary: true, content: 'must not show' }} />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('Binary');
    expect(screen.queryByText('must not show')).toBeNull();
    rerender(
      <FileViewer
        file={{ ...file, tooLarge: true, content: 'must not show' }}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('too large');
    expect(screen.queryByText('must not show')).toBeNull();
    rerender(<FileViewer file={file} denied="Path unavailable or forbidden" />);
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('forbidden');
  });
  it('highlights and scrolls a line anchor range', () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const { rerender, container } = render(<FileViewer file={file} />);
    const scroller = container.querySelector('.file-content') as HTMLDivElement;
    const selected = screen.getByLabelText('Line 2');
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    Object.defineProperty(selected, 'offsetTop', { value: 250 });
    Object.defineProperty(selected, 'offsetHeight', { value: 20 });
    rerender(<FileViewer file={file} line="#L2-L3" />);
    expect(screen.getByLabelText('Line 2, selected')).toHaveClass(
      'selected-line',
    );
    expect(screen.getByLabelText('Line 3, selected')).toHaveClass(
      'selected-line',
    );
    expect(screen.getByLabelText('Line 1')).not.toHaveClass('selected-line');
    expect(scroller.scrollTop).toBe(210);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it('windows a 10k-line file and scrolls the window to line 9000', async () => {
    const large = {
      ...file,
      content: Array.from(
        { length: 10_000 },
        (_, index) => `line ${index + 1}`,
      ).join('\n'),
    };
    const { rerender } = render(<FileViewer file={large} />);
    expect(document.querySelectorAll('.file-line code').length).toBeLessThan(
      300,
    );
    rerender(<FileViewer file={large} line="9000" />);
    expect(
      await screen.findByLabelText('Line 9000, selected'),
    ).toBeInTheDocument();
    expect(screen.getByText('line 9000')).toBeInTheDocument();
    expect(document.querySelectorAll('.file-line code').length).toBeLessThan(
      300,
    );
  });
  it('lets a clicked hash beat the query and applies the query after changing files', async () => {
    window.history.replaceState(
      window.history.state,
      '',
      '/m/local/projects/p?line=3',
    );
    const { rerender } = render(<FileViewer file={file} line="3" />);
    expect(screen.getByLabelText('Line 3, selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: '1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Line 1, selected')).toBeInTheDocument(),
    );
    expect(window.location.hash).toBe('#L1');
    rerender(<FileViewer file={{ ...file, path: 'other.ts' }} line="3" />);
    await screen.findByLabelText('Line 3, selected');
    expect(window.location.hash).toBe('');
  });
  it('does not recenter an anchor when the virtual window changes during scrolling', async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const large = {
      ...file,
      content: Array.from(
        { length: 10_000 },
        (_, index) => `line ${index + 1}`,
      ).join('\n'),
    };
    const { container } = render(<FileViewer file={large} line="9000" />);
    const scroller = container.querySelector('.file-content') as HTMLDivElement;
    await screen.findByLabelText('Line 9000, selected');
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.queryByLabelText('Line 9000, selected')).toBeNull(),
    );
    expect(scroller.scrollTop).toBe(120);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it('renders a friendly not-a-repository state', async () => {
    mock({ [`${base}/git/status`]: { isRepo: false } });
    open(<ProjectChanges projectId="p" />);
    expect(
      await screen.findByText('This project is not a Git repository.'),
    ).toBeInTheDocument();
  });
  it('fetches one per-file diff only after expansion', async () => {
    mock({
      [`${base}/git/status`]: status,
      [`${base}/git/diff?path=demo.ts`]: patch,
    });
    open(<ProjectChanges projectId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: /demo.ts/ }));
    expect(await screen.findByLabelText('Added line 1')).toHaveTextContent(
      'after',
    );
    expect(screen.getByText(/1 ahead · 2 behind/)).toBeInTheDocument();
  });
  it('renders missing project folders as an empty state', async () => {
    mock({});
    open(
      <ProjectFiles projectId="p" path="demo.ts" line="" select={vi.fn()} />,
    );
    expect(
      (await screen.findAllByText('Project folder not found on this machine'))
        .length,
    ).toBeGreaterThan(0);
  });
  it('uses calm query options for file and change data', async () => {
    mock({
      [`${base}/files?path=`]: { path: '', entries: [] },
      [`${base}/file?path=demo.ts`]: file,
      [`${base}/git/status`]: status,
      [`${base}/sessions/s/changes`]: { files: [] },
    });
    open(
      <>
        <ProjectFiles projectId="p" path="demo.ts" line="" select={vi.fn()} />
        <ProjectChanges projectId="p" />
        <SessionChanges
          projectId="p"
          sessionId="s"
          dismiss={vi.fn()}
          jump={vi.fn()}
        />
      </>,
    );
    await screen.findByText('first');
    const queries = clients[0]!.getQueryCache().findAll();
    const keys = [
      'files',
      'file',
      'git-status',
      'git-diff',
      'changes',
      'change',
    ];
    for (const key of keys) {
      const query = queries.find((item) => item.queryKey[1] === key);
      expect(query?.options).toMatchObject({
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      });
    }
  });
  it('lists session changes and step links target the conversation anchor', async () => {
    const list: SessionChangesResponse = {
      files: [
        {
          fileId: 'f',
          filePath: '/workspace/demo.ts',
          relPath: 'demo.ts',
          kind: 'update',
          additions: 1,
          deletions: 1,
          toolUseIds: ['call-1'],
          firstAt: null,
          lastAt: null,
        },
      ],
    };
    const diff: SessionFileDiffResponse = {
      fileId: 'f',
      filePath: '/workspace/demo.ts',
      hunks: patch.files[0]!.hunks,
      additions: 1,
      deletions: 1,
      source: 'tool-hunks',
      tooLarge: false,
      partial: true,
      steps: [
        {
          toolUseId: 'call-1',
          messageUuid: 'm',
          timestamp: null,
          tool: 'Edit',
          filePath: '/workspace/demo.ts',
          kind: 'update',
          hunks: patch.files[0]!.hunks,
          additions: 1,
          deletions: 1,
          source: 'structuredPatch',
          userModified: false,
        },
      ],
    };
    mock({
      [`${base}/sessions/s/changes`]: list,
      [`${base}/sessions/s/changes/f`]: diff,
    });
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    const jump = vi.fn();
    open(
      <SessionChanges
        projectId="p"
        sessionId="s"
        dismiss={vi.fn()}
        jump={jump}
      />,
    );
    const row = await screen.findByRole('button', { name: /demo.ts/ });
    expect(screen.getByText('1 files')).toBeInTheDocument();
    expect(row).toHaveTextContent('+1 −1');
    expect(screen.getByTitle('demo.ts')).toHaveClass('truncate', 'font-mono');
    fireEvent.click(row);
    const link = await screen.findByRole('link', { name: /Edit ·/ });
    expect(link).toHaveAttribute('href', '#tool-call-1');
    fireEvent.click(link);
    await waitFor(() => expect(jump).toHaveBeenCalledWith('call-1'));
  });
});

it('shows folder skeletons followed by a kit empty state', async () => {
  let finish!: (response: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  open(<FileTree projectId="p" onOpen={() => {}} />);
  const loading = screen.getByRole('status', { name: 'Loading folder' });
  expect(loading.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  finish({
    ok: true,
    status: 200,
    json: async () => ({ path: '', entries: [] }),
  });
  expect(await screen.findByText('Empty folder')).toBeInTheDocument();
});

it('shows kit skeletons for pending working tree changes', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  open(<ProjectChanges projectId="p" />);
  expect(
    screen
      .getByRole('status', { name: 'Loading' })
      .querySelectorAll('[aria-hidden="true"]'),
  ).toHaveLength(4);
});

it('shows a kit empty state before a file is selected', () => {
  render(<FileViewer />);
  expect(
    screen.getByText('Choose a file to view its contents.'),
  ).toBeInTheDocument();
});

it('appends directory pages using the returned opaque cursor and refetches loaded pages in order', async () => {
  const { refreshMachine } = await import('../live/index.js');
  const { act } = await import('@testing-library/react');
  const first = { name: 'first.ts', path: 'first.ts', type: 'file' as const };
  const last = { name: 'last.ts', path: 'last.ts', type: 'file' as const };
  let refreshed = false;
  const fetcher = vi.fn(async (url: string) => {
    const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        path: '',
        entries: [cursor ? last : first],
        nextCursor: cursor
          ? null
          : refreshed
            ? 'fresh/cursor'
            : 'opaque+cursor',
      }),
    };
  });
  vi.stubGlobal('fetch', fetcher);
  open(<FileTree projectId="p" onOpen={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Load more/ }));
  await screen.findByRole('button', { name: /last.ts/ });
  expect(
    screen.getAllByRole('button').map((button) => button.textContent),
  ).toEqual([
    expect.stringContaining('first.ts'),
    expect.stringContaining('last.ts'),
  ]);
  expect(screen.queryByRole('button', { name: /^Load more/ })).toBeNull();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `${base}/files?path=`,
    `${base}/files?path=&cursor=opaque%2Bcursor`,
  ]);
  refreshed = true;
  fetcher.mockClear();
  await act(async () => {
    await refreshMachine(clients[0]!, 'local');
  });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `${base}/files?path=`,
    `${base}/files?path=&cursor=fresh%2Fcursor`,
  ]);
  expect(screen.getAllByRole('button')).toHaveLength(2);
});

it('appends working tree status pages and paged per-file diffs, with cut notices', async () => {
  if (!status.isRepo) throw new Error('Expected fixture repository');
  mock({
    [`${base}/git/status`]: { ...status, nextCursor: 'status-next' },
    [`${base}/git/status?cursor=status-next`]: {
      ...status,
      files: [{ ...status.files[0]!, path: 'second.ts' }],
      nextCursor: null,
    },
    [`${base}/git/diff?path=demo.ts`]: {
      ...patch,
      files: [{ ...patch.files[0]!, truncated: true }],
      nextCursor: 'diff-next',
    },
    [`${base}/git/diff?path=demo.ts&cursor=diff-next`]: {
      ...patch,
      files: [{ ...patch.files[0]!, path: 'renamed.ts' }],
      nextCursor: null,
    },
  });
  open(<ProjectChanges projectId="p" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Load more/ }));
  await screen.findByRole('button', { name: /second.ts/ });
  fireEvent.click(screen.getByRole('button', { name: /demo.ts/ }));
  expect(
    await screen.findByText('Diff cut to fit the page size.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Load more/ }));
  await screen.findByRole('region', { name: 'Diff for renamed.ts' });
  expect(
    screen
      .getAllByRole('region', { name: /^Diff for/ })
      .map((region) => region.getAttribute('aria-label')),
  ).toEqual(['Diff for demo.ts', 'Diff for renamed.ts']);
  expect(screen.queryByRole('button', { name: /^Load more/ })).toBeNull();
});

it('appends session change pages and warns when the selected file diff was cut', async () => {
  const changed = {
    fileId: 'first',
    filePath: 'first.ts',
    relPath: 'first.ts',
    kind: 'update' as const,
    additions: 1,
    deletions: 1,
    toolUseIds: [],
    firstAt: null,
    lastAt: null,
  };
  mock({
    [`${base}/sessions/s/changes`]: { files: [changed], nextCursor: 'next' },
    [`${base}/sessions/s/changes?cursor=next`]: {
      files: [
        {
          ...changed,
          fileId: 'second',
          filePath: 'second.ts',
          relPath: 'second.ts',
        },
      ],
      nextCursor: null,
    },
    [`${base}/sessions/s/changes/second`]: {
      fileId: 'second',
      filePath: 'second.ts',
      additions: 1,
      deletions: 1,
      hunks: patch.files[0]!.hunks,
      steps: [],
      source: 'tool-hunks',
      truncated: true,
      tooLarge: false,
      partial: false,
    },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  open(
    <SessionChanges
      projectId="p"
      sessionId="s"
      dismiss={vi.fn()}
      jump={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: /^Load more/ }));
  fireEvent.click(await screen.findByRole('button', { name: /second.ts/ }));
  expect(
    await screen.findByText('Diff cut to fit the page size.'),
  ).toBeInTheDocument();
  expect(screen.getByText('2 files')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Load more/ })).toBeNull();
});

it('uses the existing too-large state and byte size for a budget notice', () => {
  render(
    <FileViewer
      file={{
        ...file,
        notice: 'too-large',
        size: 1234567,
        content: 'must not show',
      }}
    />,
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'File is too large to display (1,234,567 bytes).',
  );
  expect(screen.queryByText('must not show')).toBeNull();
});

it.each(['folder', 'status', 'badges', 'diff', 'session'] as const)(
  'keeps loaded %s items on next-page failure, retries only that page, and restores focus at the end',
  async (kind) => {
    if (!status.isRepo) throw new Error('Expected repository');
    const folder = (name: string) => ({
      path: '',
      entries: [{ name, path: name, type: 'file' }],
    });
    const changes = (name: string) => ({
      files: [
        {
          fileId: name,
          filePath: name,
          relPath: name,
          kind: 'update',
          additions: 1,
          deletions: 0,
          toolUseIds: [],
          firstAt: null,
          lastAt: null,
        },
      ],
    });
    const statusPage = (name: string) => ({
      ...status,
      files: [{ ...status.files[0]!, path: name }],
    });
    const diffPage = (name: string) => ({
      ...patch,
      files: [{ ...patch.files[0]!, path: name }],
    });
    const route =
      kind === 'folder'
        ? `${base}/files?path=`
        : kind === 'session'
          ? `${base}/sessions/s/changes`
          : kind === 'diff'
            ? `${base}/git/diff?path=demo.ts`
            : `${base}/git/status`;
    const label =
      kind === 'folder'
        ? 'files in this folder'
        : kind === 'session'
          ? 'session changes'
          : kind === 'diff'
            ? 'file diffs'
            : 'changed files';
    const makePage =
      kind === 'folder'
        ? folder
        : kind === 'session'
          ? changes
          : kind === 'diff'
            ? diffPage
            : statusPage;
    let attempts = 0;
    const fetcher = vi.fn(async (url: string) => {
      const isNext =
        url === `${route}${route.includes('?') ? '&' : '?'}cursor=next`;
      if (isNext && ++attempts === 1) throw new Error('temporary page failure');
      const payload =
        url === route || isNext
          ? {
              ...makePage(isNext ? 'second.ts' : 'first.ts'),
              nextCursor: isNext ? null : 'next',
            }
          : url.includes('/git/status')
            ? status
            : folder('first.ts');
      return { ok: true, status: 200, json: async () => payload };
    });
    vi.stubGlobal('fetch', fetcher);
    open(
      kind === 'folder' ? (
        <FileTree projectId="p" onOpen={vi.fn()} />
      ) : kind === 'badges' ? (
        <ProjectFiles projectId="p" path="" line="" select={vi.fn()} />
      ) : kind === 'session' ? (
        <SessionChanges
          projectId="p"
          sessionId="s"
          dismiss={vi.fn()}
          jump={vi.fn()}
        />
      ) : (
        <ProjectChanges projectId="p" />
      ),
    );
    if (kind === 'diff')
      fireEvent.click(await screen.findByRole('button', { name: /demo.ts/ }));
    const load = await screen.findByRole('button', {
      name: `Load more ${label}`,
    });
    expect(
      screen.getByText(`More ${label} are available.`),
    ).toBeInTheDocument();
    const target = load.closest('[data-page-list]');
    load.focus();
    fireEvent.click(load);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Could not load more ${label}`,
    );
    if (kind === 'diff')
      expect(
        screen.getByRole('region', { name: 'Diff for first.ts' }),
      ).toBeInTheDocument();
    else
      expect(
        screen.getByRole('button', { name: /first.ts/ }),
      ).toBeInTheDocument();
    const retry = screen.getByRole('button', {
      name: `Retry loading ${label}`,
    });
    const callsBeforeRetry = fetcher.mock.calls.length;
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: `Retry loading ${label}` }),
      ).toBeNull(),
    );
    expect(
      fetcher.mock.calls.slice(callsBeforeRetry).map(([url]) => url),
    ).toEqual([`${route}${route.includes('?') ? '&' : '?'}cursor=next`]);
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(target).toHaveFocus());
  },
);

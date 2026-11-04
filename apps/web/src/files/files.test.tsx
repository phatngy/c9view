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
const base = '/api/projects/p';
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
    window.history.replaceState(window.history.state, '', '/projects/p?line=3');
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
      const query = queries.find((item) => item.queryKey[0] === key);
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
  expect(
    await screen.findByText('Empty folder'),
  ).toBeInTheDocument();
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

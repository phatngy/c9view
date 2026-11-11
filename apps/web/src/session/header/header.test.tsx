import { useRef, useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { queryKeys } from '../../queryKeys.js';
import { sessionDetail, tokens } from '../../test-fixtures.js';
import { SessionHeader } from './SessionHeader.js';
import { SessionSearch } from './SessionSearch.js';
import { ContextGauge } from './ContextGauge.js';
import { MoreMenu } from './MoreMenu.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const data = {
  ...sessionDetail,
  byModel: [{ model: 'claude-opus-4-6', tokens, costUsd: 1 }],
  session: {
    ...sessionDetail.session,
    title: 'Session title',
    status: { ...sessionDetail.session.status, reason: 'Live status: busy' },
  },
};
const queryClient = new QueryClient();
queryClient.setQueryData(queryKeys.machines(), []);
function HeaderHarness() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const button = useRef<HTMLButtonElement | null>(null);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionHeader
        data={data}
        projectName="project"
        status={data.session.status}
        projectId="project"
        sessionId="session"
        usage={{ used: 170000, capacity: 200000, percent: 85 }}
        searchOpen={open}
        toggleSearch={() => setOpen((value) => (search ? true : !value))}
        searchButton={(node) => {
          button.current = node;
        }}
        notice={() => {}}
      />
      {open && (
        <SessionSearch
          search={search}
          change={setSearch}
          matches={0}
          selected={null}
          disabled
          previous={() => {}}
          next={() => {}}
          projectId="project"
          close={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </QueryClientProvider>
  );
}
it('shows the status, title and session metadata chips', () => {
  render(<HeaderHarness />);
  expect(screen.getByText('Inactive')).toBeInTheDocument();
  expect(screen.getByText('Live status: busy')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Session title' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Opus 4.6')).toBeInTheDocument();
  expect(screen.getByText('+1')).toBeInTheDocument();
  expect(screen.getByText('main')).toBeInTheDocument();
  expect(screen.getByText('3 messages')).toBeInTheDocument();
  expect(screen.getByText('175 tokens')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /API-equivalent/ })).toHaveAttribute(
    'href',
    '#api-equivalent-cost',
  );
});
it('labels the approximate gauge and colours high context usage as danger', () => {
  const { container } = render(
    <ContextGauge usage={{ used: 170000, capacity: 200000, percent: 85 }} />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    'Context window 85 percent full (approximate); auto-compaction near 80 percent',
  );
  expect(container.querySelector('.bg-danger')).toHaveStyle({ width: '85%' });
});
it('opens search, focuses the input and returns focus on empty Escape', () => {
  const { container } = render(<HeaderHarness />);
  const button = container.querySelector<HTMLButtonElement>(
    '.compact-session-search',
  );
  expect(button).not.toBeNull();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveAttribute('aria-controls', 'session-search');
  fireEvent.click(button!);
  const input = screen.getByRole('searchbox', {
    name: 'Search loaded messages',
  });
  expect(input).toHaveFocus();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.getByRole('button', { name: 'Session details' }),
  ).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(button).toHaveFocus();
});
it('exposes one search button in the wide header layout', () => {
  const { container } = render(<HeaderHarness />);
  const compactButton = container.querySelector<HTMLButtonElement>(
    '.compact-session-search',
  );
  expect(compactButton).not.toBeNull();
  compactButton!.style.display = 'none';
  expect(
    screen.getAllByRole('button', { name: 'Search this session' }),
  ).toHaveLength(1);
});
it('returns focus to the button that opened search', () => {
  const { container } = render(<HeaderHarness />);
  const button = container.querySelector<HTMLButtonElement>(
    '.compact-session-search',
  );
  expect(button).not.toBeNull();
  fireEvent.click(button!);
  const input = screen.getByRole('searchbox', {
    name: 'Search loaded messages',
  });
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Session details' }));
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(button!).toHaveFocus();
});
it('copies the session ID and reports the result', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const notice = vi.fn();
  render(<MoreMenu sessionId="session-id" cwd={null} notice={notice} />);
  fireEvent.click(screen.getByRole('button', { name: 'More session options' }));
  const copy = await screen.findByRole('menuitem', { name: 'Copy session ID' });
  expect(
    screen.getByRole('menuitem', { name: 'Copy working directory' }),
  ).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(copy);
  await waitFor(() => expect(notice).toHaveBeenCalledWith('Copied.'));
  expect(writeText).toHaveBeenCalledWith('session-id');
});
it('reports clipboard failures', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  const notice = vi.fn();
  render(<MoreMenu sessionId="id" cwd="/project" notice={notice} />);
  fireEvent.click(screen.getByRole('button', { name: 'More session options' }));
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Copy working directory' }),
  );
  await waitFor(() => expect(notice).toHaveBeenCalledWith('Copy failed.'));
});

it('toggles the compact header details and exposes project, model and context', () => {
  render(<HeaderHarness />);
  const button = screen.getByRole('button', { name: 'Session details' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveAttribute('aria-controls', 'session-full-header');
  expect(screen.getByText(/project · Opus 4.6 · ctx 85%/)).toBeInTheDocument();
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(button.closest('header')).toHaveAttribute('data-details-open');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button.closest('header')).not.toHaveAttribute('data-details-open');
});

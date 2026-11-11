import type { ControlRuns } from '@c9view/api';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';
import { queryKeys } from '../queryKeys.js';
import { MachineContext } from '../machine.js';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const receipt = {
  clientRequestId: 'request',
  bootId: 'node-boot',
  operation: 'reply',
  status: 'accepted',
};
function run(state: string): ControlRuns {
  return {
    runs: [
      {
        runId: 'r',
        projectId: 'p',
        sessionId: 's',
        state,
        mode: 'default',
        queued: 0,
        startedAt: '2026-11-01',
        ownedByC9view: true,
      },
    ],
    requests: [],
  } as ControlRuns;
}
function mount(snapshot: ControlRuns = run('idle')) {
  const fetcher = vi.fn((url: string) =>
    Promise.resolve(
      url.endsWith('/control/runs') ? json(snapshot) : json(receipt, 202),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'remote',
      bootId: 'node-boot',
      capabilities: { control: { state: 'ready' }, bypass: false },
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="remote">
        <Composer projectId="p" sessionId="s" />
      </MachineContext>
    </QueryClientProvider>,
  );
  return fetcher;
}
const box = () => screen.getByRole('textbox', { name: 'Reply to session' });
const posts = (fetcher: ReturnType<typeof mount>) =>
  fetcher.mock.calls.filter(([url]) => String(url).includes('/messages'));
function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
}
function setPlatform(value: string) {
  Object.defineProperty(navigator, 'platform', {
    value,
    configurable: true,
  });
}
function coarse(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches && query.includes('coarse'),
    })),
  );
}

it('Enter sends and Shift+Enter does not', async () => {
  const fetcher = mount();
  type('hello');
  fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
  expect(posts(fetcher)).toHaveLength(0);
  fireEvent.keyDown(box(), { key: 'Enter' });
  await screen.findByText('Queued');
  expect(posts(fetcher)).toHaveLength(1);
});
it('never sends during IME composition', () => {
  const fetcher = mount();
  type('こんにちは');
  fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
  fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });
  expect(posts(fetcher)).toHaveLength(0);
});
it('treats Enter as a newline on a coarse pointer', () => {
  coarse(true);
  const fetcher = mount();
  type('hello');
  const event = fireEvent.keyDown(box(), { key: 'Enter' });
  expect(event).toBe(true);
  expect(posts(fetcher)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(posts(fetcher)).toHaveLength(1);
});
it('turns the round button into Stop response while a run is working', async () => {
  const fetcher = mount(run('running'));
  const button = await screen.findAllByRole('button', {
    name: 'Stop response',
  });
  expect(button).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  fireEvent.click(button[0]!);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith('/control/runs/r/interrupt'),
      ),
    ).toBe(true),
  );
});
it('shows Send for an idle run and stays disabled when empty', async () => {
  mount(run('idle'));
  expect(await screen.findByRole('button', { name: 'Send' })).toBeDisabled();
});
it('shows the counter only near the limit', () => {
  mount();
  type('x'.repeat(17_999));
  expect(screen.queryByText(/\/ 20,000/)).toBeNull();
  type('x'.repeat(18_000));
  expect(screen.getByText('18,000 / 20,000')).toBeVisible();
});
it('auto-grows to its content and caps at 40% of the viewport', () => {
  vi.stubGlobal('innerHeight', 1000);
  mount();
  expect(box()).toHaveClass('resize-none', 'max-h-[40dvh]');
  vi.spyOn(
    HTMLTextAreaElement.prototype,
    'scrollHeight',
    'get',
  ).mockReturnValue(120);
  type('a\nb\nc');
  expect(box().style.height).toBe('120px');
  vi.spyOn(
    HTMLTextAreaElement.prototype,
    'scrollHeight',
    'get',
  ).mockReturnValue(900);
  type('a\nb\nc\nd');
  expect(box().style.height).toBe('400px');
});
it('has 44px targets and accessible names on the toolbar', () => {
  mount();
  for (const name of ['Send', 'Permission mode']) {
    expect(
      screen.getByRole(name === 'Permission mode' ? 'combobox' : 'button', {
        name,
      }),
    ).toHaveClass('min-h-11');
  }
});
it('Ctrl+Enter always sends, even on a coarse pointer, but not during IME', async () => {
  setPlatform('Linux x86_64');
  coarse(true);
  const fetcher = mount();
  type('hello');
  fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(posts(fetcher)).toHaveLength(0);
  fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
  await screen.findByText('Queued');
  expect(posts(fetcher)).toHaveLength(1);
});
it('Cmd+Enter sends on macOS', async () => {
  setPlatform('MacIntel');
  const fetcher = mount();
  type('hello');
  fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
  await screen.findByText('Queued');
  expect(posts(fetcher)).toHaveLength(1);
});
it('checks for a touch-only device with hover none and coarse pointer', () => {
  const matchMedia = vi.fn(() => ({ matches: false }));
  vi.stubGlobal('matchMedia', matchMedia);
  mount();
  type('x');
  fireEvent.keyDown(box(), { key: 'Enter' });
  expect(matchMedia).toHaveBeenCalledWith(
    '(hover: none) and (pointer: coarse)',
  );
});
it('moves focus to the reply box after a successful Stop response, never onto a button', async () => {
  mount(run('running'));
  const bar = await screen.findByRole('button', { name: 'Stop response' });
  fireEvent.click(bar);
  await waitFor(() => expect(box()).toHaveFocus());
});
it('does not steal focus from another field after Stop response', async () => {
  mount(run('running'));
  const other = document.createElement('input');
  document.body.append(other);
  const bar = await screen.findByRole('button', { name: 'Stop response' });
  fireEvent.click(bar);
  other.focus();
  await new Promise((r) => setTimeout(r, 50));
  expect(other).toHaveFocus();
  other.remove();
});

it('after a confirmed Stop the reply box is enabled and focused', async () => {
  const fetcher = mount(run('running'));
  const trigger = await screen.findByRole('button', { name: 'Run options' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith('/control/runs/r/stop'),
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(box()).toHaveFocus());
  expect(box()).toBeEnabled();
});

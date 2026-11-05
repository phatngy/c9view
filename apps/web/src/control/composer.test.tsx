import type { ControlRuns } from '@c9view/api';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
function mount(snapshot: ControlRuns = run('idle'), lastResponse?: string) {
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
        <Composer projectId="p" sessionId="s" lastResponse={lastResponse} />
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
  expect(screen.getByRole('button', { name: 'Interrupt' })).toBeVisible();
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
  for (const name of ['Send', 'Keyboard shortcuts', 'Permission mode']) {
    expect(
      screen.getByRole(name === 'Permission mode' ? 'combobox' : 'button', {
        name,
      }),
    ).toHaveClass('min-h-11');
  }
});
it.each([
  ['Linux x86_64', { ctrlKey: true }],
  ['MacIntel', { metaKey: true }],
])('focuses the composer with the platform shortcut (%s)', (platform, mod) => {
  setPlatform(platform);
  mount();
  screen.getByRole('combobox', { name: 'Permission mode' }).focus();
  fireEvent.keyDown(window, {
    key: ':',
    code: 'Semicolon',
    shiftKey: true,
    ...mod,
  });
  expect(box()).toHaveFocus();
  expect(box()).toHaveAttribute(
    'aria-keyshortcuts',
    `${platform === 'MacIntel' ? 'Meta' : 'Control'}+Shift+;`,
  );
});
it('ignores the wrong modifier for the platform and plain keys', () => {
  setPlatform('Linux x86_64');
  mount();
  fireEvent.keyDown(window, {
    key: ':',
    code: 'Semicolon',
    shiftKey: true,
    metaKey: true,
  });
  fireEvent.keyDown(window, { key: ';', code: 'Semicolon' });
  expect(box()).not.toHaveFocus();
});
it('works while typing in the composer and copies the last response', async () => {
  setPlatform('Linux x86_64');
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), { clipboard: { writeText } }),
  );
  mount(run('idle'), 'Shown reply');
  box().focus();
  fireEvent.keyDown(box(), {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
  });
  await screen.findByText('Copied');
  expect(writeText).toHaveBeenCalledWith('Shown reply');
  expect(box()).toHaveFocus();
});
it('announces when there is nothing to copy', async () => {
  setPlatform('Linux x86_64');
  mount();
  fireEvent.keyDown(window, {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
  });
  await screen.findByText('Nothing to copy');
});
it('ignores every shortcut during IME composition', () => {
  setPlatform('Linux x86_64');
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), { clipboard: { writeText } }),
  );
  mount(run('idle'), 'Shown reply');
  fireEvent.keyDown(window, {
    key: ':',
    code: 'Semicolon',
    ctrlKey: true,
    shiftKey: true,
    isComposing: true,
  });
  fireEvent.keyDown(window, {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
    keyCode: 229,
  });
  expect(box()).not.toHaveFocus();
  expect(writeText).not.toHaveBeenCalled();
});
it('leaves Ctrl+K to the existing search binding', () => {
  setPlatform('Linux x86_64');
  mount();
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    cancelable: true,
    bubbles: true,
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(box()).not.toHaveFocus();
});
it.each([
  ['Linux x86_64', 'Ctrl'],
  ['MacIntel', '⌘'],
])(
  'lists the right modifier in the shortcuts help (%s)',
  async (platform, mod) => {
    setPlatform(platform);
    mount();
    const help = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    help.focus();
    fireEvent.click(help);
    const popup = await screen.findByRole('dialog', {
      name: 'Keyboard shortcuts',
    });
    expect(popup).toHaveTextContent('Enter');
    expect(popup).toHaveTextContent('Shift');
    const keys = [...popup.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys).toContain(mod);
    expect(keys).not.toContain(mod === 'Ctrl' ? '⌘' : 'Ctrl');
    fireEvent.keyDown(popup, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
);

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
it('lists Ctrl+Enter in the help', async () => {
  setPlatform('Linux x86_64');
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
  const popup = await screen.findByRole('dialog', {
    name: 'Keyboard shortcuts',
  });
  expect(popup).toHaveTextContent('SendCtrlEnter');
});
it('copies through a hidden textarea when the Clipboard API is missing', async () => {
  setPlatform('Linux x86_64');
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), { clipboard: undefined }),
  );
  const exec = vi.fn(() => true);
  document.execCommand = exec;
  mount(run('idle'), 'Shown reply');
  fireEvent.keyDown(window, {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
  });
  await screen.findByText('Copied');
  expect(exec).toHaveBeenCalledWith('copy');
  expect(document.querySelectorAll('body > textarea[readonly]')).toHaveLength(
    0,
  );
});
it('announces Could not copy when every path fails', async () => {
  setPlatform('Linux x86_64');
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), { clipboard: undefined }),
  );
  document.execCommand = vi.fn(() => {
    throw new Error('denied');
  });
  mount(run('idle'), 'Shown reply');
  fireEvent.keyDown(window, {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
  });
  await screen.findByText('Could not copy');
});
it('leaves Ctrl+Shift+C alone when text is selected', () => {
  setPlatform('Linux x86_64');
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), { clipboard: { writeText } }),
  );
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => 'picked',
  } as Selection);
  mount(run('idle'), 'Shown reply');
  const event = new KeyboardEvent('keydown', {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
    bubbles: true,
  });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(writeText).not.toHaveBeenCalled();
});
it('ignores shortcuts that start inside a dialog', () => {
  setPlatform('Linux x86_64');
  mount();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const field = document.createElement('button');
  dialog.append(field);
  document.body.append(dialog);
  fireEvent.keyDown(field, {
    key: ':',
    code: 'Semicolon',
    ctrlKey: true,
    shiftKey: true,
  });
  expect(box()).not.toHaveFocus();
  dialog.remove();
});

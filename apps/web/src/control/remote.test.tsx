import type {
  CommandReceipt,
  ControlRuns,
  Message,
  RemoteAvailability,
  RemoteDelivery,
  SessionStatus,
} from '@c9view/api';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Conversation } from '../session/Conversation.js';
import { MachineContext } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { Composer } from './Composer.js';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
const clients: QueryClient[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SEND = 'Send to the terminal session';
const available: RemoteAvailability = {
  sessionId: 's',
  available: true,
  sessionState: 'idle',
  checkedAt: '2026-11-17T00:00:00.000Z',
};
const refused = (patch: Partial<RemoteAvailability>): RemoteAvailability => ({
  sessionId: 's',
  available: false,
  checkedAt: '2026-11-17T00:00:00.000Z',
  ...patch,
});
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function receipt(
  delivery: RemoteDelivery,
  id = 'command',
  status: CommandReceipt['status'] = 'done',
): CommandReceipt {
  return {
    clientRequestId: id,
    bootId: 'node-boot',
    operation: 'remote',
    status,
    projectId: 'p',
    sessionId: 's',
    delivery,
  };
}

interface Scenario {
  availability?: () => RemoteAvailability;
  post?: (body: {
    text: string;
    clientRequestId: string;
  }) => Response | Promise<Response>;
  receipt?: (id: string) => Response;
  runs?: ControlRuns;
}
function mount(scenario: Scenario = {}, status?: SessionStatus) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/control/runs'))
      return Promise.resolve(json(scenario.runs ?? { runs: [], requests: [] }));
    if (url.endsWith('/remote') && init?.method === 'POST')
      return Promise.resolve(
        scenario.post?.(JSON.parse(init.body as string)) ??
          json(receipt({ state: 'sent' }), 202),
      );
    if (url.endsWith('/remote'))
      return Promise.resolve(json(scenario.availability?.() ?? available));
    if (url.includes('/control/receipts/'))
      return Promise.resolve(
        scenario.receipt?.(url.split('/').pop()!) ??
          json(receipt({ state: 'sent' })),
      );
    return Promise.resolve(json({ error: 'unexpected' }, 500));
  });
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
  const view = render(
    <QueryClientProvider client={client}>
      <MachineContext value="remote">
        <Composer projectId="p" sessionId="s" status={status} />
      </MachineContext>
    </QueryClientProvider>,
  );
  const posts = () =>
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  return { fetcher, client, posts, view };
}
const box = () => screen.getByRole('textbox', { name: 'Reply to session' });
function type(text = 'Hello terminal') {
  fireEvent.change(box(), { target: { value: text } });
}
const remoteButton = () => screen.findByRole('button', { name: SEND });
async function sendRemote(text?: string) {
  const button = await remoteButton();
  type(text);
  fireEvent.click(button);
}
const body = (call: unknown[]) =>
  JSON.parse((call[1] as RequestInit).body as string) as {
    text: string;
    clientRequestId: string;
  };

it('T049 offers remote mode with the exact heading, label and slash note', async () => {
  const { fetcher, posts } = mount();
  await remoteButton();
  expect(
    screen.getByText(
      'This session is open in a terminal. Your message goes into it as a message from another session.',
    ),
  ).toBeVisible();
  expect(box()).toHaveAttribute('placeholder', 'Message the terminal session…');
  expect(screen.queryByText(/Slash commands don't run this way/)).toBeNull();
  type('/compact');
  expect(
    screen.getByText(
      "Slash commands don't run this way; this is sent as plain text.",
    ),
  ).toBeVisible();
  type('Hello terminal');
  fireEvent.click(screen.getByRole('button', { name: SEND }));
  await screen.findAllByText('Sent. Waiting for the session to pick it up…');
  const call = posts()[0]!;
  expect(call[0]).toBe('/api/m/remote/projects/p/sessions/s/remote');
  expect(call[1]).toMatchObject({
    headers: {
      'Content-Type': 'application/json',
      'X-C9view-Control': '1',
      'X-C9view-Boot-Id': 'node-boot',
    },
  });
  expect(body(call)).toEqual({
    text: 'Hello terminal',
    clientRequestId: expect.stringMatching(/^[\da-f-]{36}$/),
  });
  // One POST, to the remote route only: no reply and no new session.
  expect(posts()).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(
    false,
  );
  expect(box()).toHaveValue('');
});

it('T049 keeps 002 reply mode for a session no terminal holds', async () => {
  mount({ availability: () => refused({ reason: 'not-live' }) });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument(),
  );
  expect(screen.queryByRole('button', { name: SEND })).toBeNull();
  expect(box()).toHaveAttribute('placeholder', 'Reply to Claude…');
});

it('T049 keeps 002 reply mode and never asks for availability on its own run', async () => {
  const { fetcher } = mount({
    runs: {
      runs: [
        {
          runId: 'r',
          projectId: 'p',
          sessionId: 's',
          state: 'idle',
          mode: 'default',
          queued: 0,
          startedAt: '2026-11-17',
          ownedByC9view: true,
        },
      ],
      requests: [],
    } as ControlRuns,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument(),
  );
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/remote'))).toBe(
    false,
  );
});

it('T049 locks Send while the command is pending and keeps the text', async () => {
  let finish!: (response: Response) => void;
  const { posts } = mount({
    post: () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  });
  await sendRemote();
  await waitFor(() => expect(box()).toBeDisabled());
  expect(screen.getByRole('button', { name: SEND })).toBeDisabled();
  expect(box()).toHaveValue('Hello terminal');
  fireEvent.click(screen.getByRole('button', { name: SEND }));
  expect(posts()).toHaveLength(1);
  finish(json(receipt({ state: 'sent' }), 202));
  await waitFor(() => expect(box()).toBeEnabled());
  // Focus returns to the composer so the owner can keep typing.
  await waitFor(() => expect(box()).toHaveFocus());
});

it('T049 never re-sends a lost response by itself; a resend after expiry is a new command', async () => {
  let calls = 0;
  const { posts } = mount({
    post: () => {
      calls++;
      return calls === 1
        ? json({ error: 'Gateway timeout' }, 504)
        : json(receipt({ state: 'sent' }), 202);
    },
    receipt: () => json({ error: 'Not found' }, 404),
  });
  await sendRemote();
  await screen.findAllByText(
    'c9view stopped tracking this message. Check the conversation.',
    {},
    { timeout: 4000 },
  );
  expect(posts()).toHaveLength(1);
  expect(box()).toHaveValue('Hello terminal');
  fireEvent.click(screen.getByRole('button', { name: SEND }));
  await screen.findAllByText('Sent. Waiting for the session to pick it up…');
  expect(posts()).toHaveLength(2);
  expect(body(posts()[1]!).clientRequestId).not.toBe(
    body(posts()[0]!).clientRequestId,
  );
  // Settled: the next message is a new command.
  type('Another');
  fireEvent.click(screen.getByRole('button', { name: SEND }));
  await waitFor(() => expect(posts()).toHaveLength(3));
  expect(body(posts()[2]!).clientRequestId).not.toBe(
    body(posts()[0]!).clientRequestId,
  );
});

it.each<[string, RemoteDelivery, string, boolean]>([
  [
    'sent',
    { state: 'sent' },
    'Sent. Waiting for the session to pick it up…',
    false,
  ],
  [
    'delivered new turn',
    { state: 'delivered', turn: 'new-turn' },
    'Delivered: Claude is starting a new turn.',
    false,
  ],
  [
    'delivered next step',
    { state: 'delivered', turn: 'next-step' },
    'Delivered: Claude sees it at its next step.',
    false,
  ],
  [
    'not seen',
    { state: 'not-seen' },
    'Sent, not seen yet: the session may be busy with a long step, or holding or refusing messages.',
    false,
  ],
  [
    'uncertain',
    { state: 'uncertain' },
    'This may have been sent. c9view is watching the conversation for it.',
    false,
  ],
  [
    'ended',
    { state: 'failed', reason: 'session-ended' },
    'Not delivered: the terminal session ended.',
    true,
  ],
  [
    'unreachable',
    { state: 'failed', reason: 'unreachable' },
    "Not delivered: the session couldn't be reached.",
    true,
  ],
])(
  'T055 shows %s and keeps the draft only for a failure',
  async (_n, delivery, text, keeps) => {
    mount({
      post: () =>
        json(
          receipt(
            delivery,
            'command',
            delivery.state === 'failed' ? 'failed' : 'done',
          ),
          202,
        ),
    });
    await sendRemote();
    await screen.findAllByText(
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    expect(box()).toHaveValue(keeps ? 'Hello terminal' : '');
    // Sending again after a failure is a new command with a fresh ID.
  },
);

it('T055 follows not-seen to delivered and announces each outcome once', async () => {
  let state: RemoteDelivery = { state: 'sent' };
  const { client } = mount({
    post: () => json(receipt({ state: 'sent' }), 202),
    receipt: () => json(receipt(state)),
  });
  await sendRemote();
  const status = () => document.getElementById('reply-status')!;
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const text = status().textContent ?? '';
    if (text && seen.at(-1) !== text) seen.push(text);
  });
  observer.observe(status(), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  const refresh = () =>
    act(async () => {
      await client.invalidateQueries({
        queryKey: queryKeys.controlReceipt('remote', 'command'),
      });
    });
  state = { state: 'not-seen' };
  await refresh();
  await waitFor(() => expect(status().textContent).toMatch(/not seen yet/));
  state = {
    state: 'delivered',
    turn: 'next-step',
    deliveredAt: '2026-11-17T01:02:03.000Z',
  };
  await refresh();
  await waitFor(() =>
    expect(status().textContent).toBe(
      'Delivered: Claude sees it at its next step.',
    ),
  );
  // Repeated and refetched state adds nothing.
  await refresh();
  await refresh();
  observer.disconnect();
  expect(seen.filter((text) => text.startsWith('Delivered'))).toHaveLength(1);
  expect(seen.filter((text) => text.startsWith('Sent, not seen'))).toHaveLength(
    1,
  );
});

it('T055 turns uncertain into delivered', async () => {
  let state: RemoteDelivery = { state: 'uncertain' };
  const { client } = mount({
    post: () => json(receipt({ state: 'uncertain' }), 202),
    receipt: () => json(receipt(state)),
  });
  await sendRemote();
  await screen.findAllByText(/This may have been sent\. c9view is watching/);
  state = { state: 'delivered', turn: 'new-turn' };
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.controlReceipt('remote', 'command'),
    });
  });
  await screen.findAllByText('Delivered: Claude is starting a new turn.');
});

it('T055 explains a receipt that expired while tracking', async () => {
  let expired = false;
  const { client } = mount({
    post: () => json(receipt({ state: 'not-seen' }), 202),
    receipt: () =>
      expired
        ? json({ error: 'Not found' }, 404)
        : json(receipt({ state: 'not-seen' })),
  });
  await sendRemote();
  await screen.findAllByText(/Sent, not seen yet/);
  expired = true;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.controlReceipt('remote', 'command'),
    });
  });
  await screen.findAllByText(
    'c9view stopped tracking this message. Check the conversation.',
  );
});

it('T055 learns of a command sent from another tab through its receipt', async () => {
  const { client } = mount({
    receipt: (id) =>
      json(receipt({ state: 'delivered', turn: 'new-turn' }, id)),
  });
  await remoteButton();
  const { addRemoteCommand } = await import('./useRemote.js');
  act(() => addRemoteCommand(client, 'remote', 'p', 's', 'other-tab'));
  await screen.findAllByText('Delivered: Claude is starting a new turn.');
});

it.each<[Partial<RemoteAvailability>, string, string | undefined]>([
  [
    { reason: 'liveness-unknown' },
    "c9view can't tell whether another process holds this session.",
    'Check the terminal. Nothing is sent or resumed until c9view can tell.',
  ],
  [
    { reason: 'too-old', minVersion: '2.1.318' },
    'Update Claude Code to 2.1.318 or newer.',
    'Restart the session in the terminal after updating.',
  ],
  [
    { reason: 'no-address' },
    "This session can't be reached: it has no messaging address.",
    'Update Claude Code, or turn on cross-session messaging in that session.',
  ],
  [
    { reason: 'unknown-protocol' },
    "This session uses a messaging version c9view doesn't know.",
    'Update c9view.',
  ],
  [
    { reason: 'not-interactive' },
    'This is not an interactive terminal session. Only those can receive messages.',
    undefined,
  ],
  [
    { reason: 'address-invalid' },
    "This session's messaging address can't be confirmed as its own.",
    'Restart the session in the terminal.',
  ],
  [
    { reason: 'inbound-refused' },
    'This session refuses messages from other sessions.',
    "Change crossSessionInbound in that session's settings.",
  ],
  [
    { reason: 'token-required' },
    "This session can't be reached: it requires a token c9view doesn't keep.",
    undefined,
  ],
  [
    { reason: 'unsupported-platform' },
    "Sending to terminal sessions isn't supported on this machine yet.",
    undefined,
  ],
  [
    { reason: 'control-unavailable' },
    'Session control is unavailable on this machine right now.',
    undefined,
  ],
])('T063 refuses with the reason and fix for %j', async (patch, text, fix) => {
  const { posts } = mount({ availability: () => refused(patch) });
  const send = await remoteButton();
  type('Keep this text');
  expect(send).toBeDisabled();
  expect(screen.getByText(text)).toBeVisible();
  if (fix) {
    const notice = document.getElementById('remote-notice')!;
    expect(notice.textContent).toContain(fix);
  }
  expect(box()).toHaveValue('Keep this text');
  fireEvent.keyDown(box(), { key: 'Enter' });
  expect(posts()).toHaveLength(0);
  expect(screen.queryByText(/send when free|queue/i)).toBeNull();
});

it.each<['hold' | 'may-hold', string]>([
  [
    'hold',
    'This session holds messages until you let them in at the terminal.',
  ],
  [
    'may-hold',
    "This session may hold messages from c9view: it may be in bypass mode, or its permission mode isn't known.",
  ],
])('T063 warns on %s and keeps Send enabled', async (inbound, text) => {
  mount({ availability: () => ({ ...available, inbound }) });
  const send = await remoteButton();
  expect(document.getElementById('remote-notice')!.textContent).toContain(text);
  type();
  expect(send).toBeEnabled();
});

it('T063 refuses on a stale check, then a new command after the owner fixes it', async () => {
  let fixed = false;
  const { client, posts } = mount({
    availability: () => (fixed ? available : refused({ reason: 'no-address' })),
    post: (request) =>
      fixed
        ? json(receipt({ state: 'sent' }, request.clientRequestId), 202)
        : json(
            {
              error: 'Remote send is unavailable',
              reason: 'remote-unavailable',
              availability: refused({ reason: 'inbound-refused' }),
            },
            409,
          ),
  });
  // The page still believes the session is available when the owner sends.
  client.setQueryData(
    queryKeys.remoteAvailability('remote', 'p', 's'),
    available,
  );
  await sendRemote();
  await screen.findAllByText(
    'This session refuses messages from other sessions.',
  );
  expect(box()).toHaveValue('Hello terminal');
  expect(screen.getByRole('button', { name: SEND })).toBeDisabled();
  fixed = true;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.remoteAvailability('remote', 'p', 's'),
    });
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: SEND })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: SEND }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(body(posts()[1]!).clientRequestId).not.toBe(
    body(posts()[0]!).clientRequestId,
  );
});

it('T063 switches to reply when the process ends and sends nothing', async () => {
  let live = true;
  const { client, posts } = mount({
    availability: () => (live ? available : refused({ reason: 'not-live' })),
  });
  await remoteButton();
  type('Typed before it ended');
  live = false;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.remoteAvailability('remote', 'p', 's'),
    });
  });
  await screen.findByRole('button', { name: 'Send' });
  expect(box()).toHaveValue('Typed before it ended');
  expect(posts()).toHaveLength(0);
});

it('T063 asks to approve in the terminal and offers no decision control', async () => {
  mount(
    { availability: () => ({ ...available, sessionState: 'waiting' }) },
    {
      column: 'need_input',
      reason: 'waiting',
      source: 'live-status',
      observedAt: null,
      stale: false,
    },
  );
  await remoteButton();
  expect(
    screen.getByText(
      'Claude is waiting for a decision. Approve in the terminal.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /allow|approve|deny/i }),
  ).toBeNull();
});

it('T066 keeps 44 px targets and reachable names on the remote controls', async () => {
  mount();
  const send = await remoteButton();
  expect(send.className).toContain('min-h-11');
  expect(send.className).toContain('min-w-11');
  expect(send).toHaveAttribute('title', SEND);
  expect(box()).toHaveAccessibleDescription(/message from another session/);
});

const sender = (patch: Partial<Message>): Message => ({
  uuid: 'm',
  role: 'user',
  timestamp: '2026-11-17T00:00:00.000Z',
  model: null,
  isMeta: true,
  isSidechain: false,
  blocks: [{ type: 'text', text: 'Hello from the web' }],
  usage: null,
  ...patch,
});

it('T059 labels c9view messages with their confidence and nothing else', () => {
  render(
    <Conversation
      messages={[
        sender({
          uuid: 'verified',
          sentFrom: 'c9view',
          sentFromVerified: true,
        }),
        sender({
          uuid: 'unverified',
          sentFrom: 'c9view',
          sentFromVerified: false,
          blocks: [{ type: 'text', text: 'Unconfirmed text' }],
        }),
        sender({
          uuid: 'typed',
          isMeta: false,
          blocks: [{ type: 'text', text: 'Typed in the terminal' }],
        }),
        sender({
          uuid: 'peer',
          sentFrom: 'peer',
          blocks: [{ type: 'text', text: 'Other session' }],
        }),
      ]}
    />,
  );
  expect(screen.getByText('Hello from the web')).toBeVisible();
  expect(screen.getByText('Unconfirmed text')).toBeVisible();
  const labels = screen.getAllByRole('note');
  expect(labels).toHaveLength(2);
  expect(
    screen.getByRole('note', { name: 'Sent from c9view' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('note', {
      name: "Marked as sent from c9view; c9view can't confirm this after a restart",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText('Typed in the terminal')).toBeVisible();
  expect(screen.queryByText('Other session')).toBeNull();
});

it('T055 announces a restored command once when its outcome changes after mount', async () => {
  localStorage.setItem('c9view.remote.remote.p.s', JSON.stringify(['earlier']));
  let state: RemoteDelivery = { state: 'not-seen' };
  const { client } = mount({
    receipt: (id) => json(receipt(state, id)),
  });
  await screen.findAllByText(/Sent, not seen yet/);
  const status = () => document.getElementById('reply-status')!.textContent;
  // First sight of a restored command is shown, not announced.
  expect(status()).toBe('');
  state = { state: 'delivered', turn: 'new-turn' };
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.controlReceipt('remote', 'earlier'),
    });
  });
  await waitFor(() => expect(status()).toBe(newTurnText));
});
const newTurnText = 'Delivered: Claude is starting a new turn.';

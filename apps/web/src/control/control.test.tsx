import type { ControlRuns } from '@c9view/api';
import { RunBar } from './RunBar.js';
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
import { controlApi, ControlError } from './api.js';
import { queryKeys } from '../queryKeys.js';
import { MachineContext } from '../machine.js';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  navigate.mockReset();
});
const receipt = {
  clientRequestId: 'request',
  bootId: 'node-boot',
  operation: 'reply',
  status: 'accepted',
};
const trust = {
  path: '/fixture/project',
  fingerprint: 'first',
  hooks: [],
  mcpServers: [],
  allowRules: [],
  plugins: [],
  hasClaudeMd: false,
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function mount(
  state = 'ready',
  bypass = false,
  handler?: (url: string, init?: RequestInit) => Response | Promise<Response>,
  snapshot: ControlRuns = { runs: [], requests: [] },
) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/control/runs')) return Promise.resolve(json(snapshot));
    return Promise.resolve(handler?.(url, init) ?? json(receipt, 202));
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
      capabilities: { control: { state }, bypass },
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="remote">
        <Composer projectId="p" sessionId="s" />
      </MachineContext>
    </QueryClientProvider>,
  );
  return { fetcher, client };
}
function send(text = 'Fixture reply') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply to session' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

it.each(['off', 'unavailable'])(
  'T041 hides the composer and does not read runs when control is %s',
  (state) => {
    const { fetcher } = mount(state);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('T041 posts a guarded machine-scoped reply and shows Queued', async () => {
  const { fetcher } = mount();
  send();
  await screen.findByText('Queued');
  const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(call[0]).toBe('/api/m/remote/projects/p/sessions/s/messages');
  expect(call[1]?.headers).toEqual({
    'Content-Type': 'application/json',
    'X-C9view-Control': '1',
    'X-C9view-Boot-Id': 'node-boot',
  });
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    text: 'Fixture reply',
    clientRequestId: expect.stringMatching(/^[\da-f-]{36}$/),
  });
  expect(screen.getByRole('textbox')).toHaveValue('');
});
it('T050 caps replies at 20,000 characters and counts them', () => {
  mount();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'x'.repeat(20001) },
  });
  expect(screen.getByRole('textbox')).toHaveValue('x'.repeat(20000));
  expect(screen.getByText('20,000 / 20,000')).toBeVisible();
});
it.each(['live-elsewhere', 'liveness-unknown'])(
  'T042 offers a fork for %s and navigates to its receipt session',
  async (reason) => {
    const { fetcher } = mount('ready', false, (_url, init) =>
      JSON.parse(init!.body as string).fork
        ? json({ ...receipt, sessionId: 'forked' }, 202)
        : json({ error: reason, reason }, 409),
    );
    send();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Fork and reply' }),
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { machineId: 'remote', projectId: 'p', sessionId: 'forked' },
        }),
      ),
    );
    const posts = fetcher.mock.calls.filter(
      ([, init]) => init?.method === 'POST',
    );
    expect(JSON.parse(posts[1]![1]!.body as string)).toMatchObject({
      fork: true,
      text: 'Fixture reply',
    });
    expect(JSON.parse(posts[0]![1]!.body as string).clientRequestId).not.toBe(
      JSON.parse(posts[1]![1]!.body as string).clientRequestId,
    );
  },
);
it.each(['503', 'timeout'])(
  'T043 recovers a %s through the receipt without reposting',
  async (failure) => {
    let resolveReceipt!: (value: Response) => void;
    const read = new Promise<Response>((resolve) => {
      resolveReceipt = resolve;
    });
    const { fetcher } = mount('ready', false, (url) =>
      url.includes('/receipts/')
        ? read
        : failure === '503'
          ? json({ error: 'Unavailable' }, 503)
          : Promise.reject(new DOMException('Timed out', 'TimeoutError')),
    );
    send();
    await screen.findByText('This may have been sent');
    resolveReceipt(json(receipt));
    await screen.findByText('Queued');
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  },
);
it('T043 explains unknown-outcome', async () => {
  mount('ready', false, () =>
    json({ error: 'unknown', reason: 'unknown-outcome' }, 409),
  );
  send();
  await screen.findByText(/may or may not have run/);
});
it('T046 shows changed settings then trusts the fresh fingerprint and retries the reply', async () => {
  let trusted = false;
  let trustCalls = 0;
  const { fetcher } = mount('ready', false, (url) => {
    if (url.endsWith('/projects/trust')) {
      trustCalls++;
      if (trustCalls === 1)
        return json(
          {
            error: 'Settings changed',
            reason: 'settings-changed',
            trust: { ...trust, fingerprint: 'second', hooks: ['fixture hook'] },
          },
          409,
        );
      trusted = true;
      return json({ ...receipt, operation: 'trust', status: 'done' });
    }
    return trusted
      ? json(receipt, 202)
      : json(
          { error: 'Untrusted folder', reason: 'untrusted-folder', trust },
          409,
        );
  });
  send();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Trust this folder' }),
  );
  await screen.findByText('fixture hook');
  fireEvent.click(screen.getByRole('button', { name: 'Trust this folder' }));
  await screen.findByText('Queued');
  const posts = fetcher.mock.calls.filter(
    ([, init]) => init?.method === 'POST',
  );
  expect(posts).toHaveLength(4);
  expect(JSON.parse(posts[2]![1]!.body as string)).toMatchObject({
    path: trust.path,
    fingerprint: 'second',
  });
  expect(JSON.parse(posts[3]![1]!.body as string)).toMatchObject({
    text: 'Fixture reply',
  });
});
it('T047 replaces the mode menu with a text Bypass badge', () => {
  mount('ready', true);
  expect(
    screen.queryByRole('combobox', { name: 'Permission mode' }),
  ).toBeNull();
  expect(screen.getByText('Bypass')).toBeVisible();
});
it('T047 shows the mode menu without bypass', () => {
  mount();
  expect(
    screen.getByRole('combobox', { name: 'Permission mode' }),
  ).toBeVisible();
});
it.each([400, 409, 429, 503])(
  'T048 maps HTTP %s into a typed failure',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Refused', reason: 'decided' }, status)),
    );
    await expect(
      controlApi('remote', 'node-boot').stop('run'),
    ).rejects.toBeInstanceOf(ControlError);
  },
);
it('T048 validates receipts and tolerates unknown fields', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...receipt, future: true })),
  );
  await expect(
    controlApi('remote', 'node-boot').receipt('request'),
  ).resolves.toEqual(receipt);
});

it('T043 treats an expired receipt as unknown without replaying the reply', async () => {
  const { fetcher } = mount('ready', false, (url) =>
    url.includes('/receipts/')
      ? json({ error: 'Expired' }, 404)
      : json({ error: 'Unavailable' }, 503),
  );
  send();
  await screen.findByText(/may or may not have run/);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
});
it('T042 waits for the fork session ID in the receipt', async () => {
  mount('ready', false, (url, init) =>
    url.includes('/receipts/')
      ? json({ ...receipt, sessionId: 'fork-from-receipt' })
      : JSON.parse(init!.body as string).fork
        ? json(receipt, 202)
        : json({ error: 'Held elsewhere', reason: 'live-elsewhere' }, 409),
  );
  send();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Fork and reply' }),
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ sessionId: 'fork-from-receipt' }),
      }),
    ),
  );
});
it('T048 gives each command a fresh ID, keeps the captured boot ID and parses every mutation response', async () => {
  const fetcher = vi.fn(async () => json({ ...receipt, futureField: true }));
  vi.stubGlobal('fetch', fetcher);
  const service = controlApi('remote machine', 'captured-boot');
  await service.reply('p/q', 's/r', 'reply');
  await service.decide('request/id', { decision: 'allow' });
  await service.interrupt('run/id');
  await service.stop('run/id');
  await service.mode('run/id', 'plan');
  await service.trust('/fixture/project', 'fingerprint');
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls.map(([url]) => url)).toEqual([
    '/api/m/remote%20machine/projects/p%2Fq/sessions/s%2Fr/messages',
    '/api/m/remote%20machine/control/requests/request%2Fid',
    '/api/m/remote%20machine/control/runs/run%2Fid/interrupt',
    '/api/m/remote%20machine/control/runs/run%2Fid/stop',
    '/api/m/remote%20machine/control/runs/run%2Fid/mode',
    '/api/m/remote%20machine/projects/trust',
  ]);
  const ids = calls.map(
    ([, init]) => JSON.parse(init.body as string).clientRequestId,
  );
  expect(new Set(ids).size).toBe(6);
  for (const [, init] of calls)
    expect(init.headers).toMatchObject({ 'X-C9view-Boot-Id': 'captured-boot' });
});

it('T051 shows state and badges and locks run actions while pending', async () => {
  let finish!: () => void;
  const stopped = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <RunBar
      run={{
        runId: 'r',
        projectId: 'p',
        sessionId: 's',
        state: 'running',
        mode: 'bypassPermissions',
        queued: 2,
        costUsd: 1.25,
        startedAt: '2026-11-01',
        ownedByC9view: true,
      }}
      onStop={stopped}
    />,
  );
  expect(screen.getByText('Working…')).toBeVisible();
  expect(screen.getByText('· 2 queued')).toBeVisible();
  expect(screen.getByText('Driven by c9view')).toBeVisible();
  expect(screen.getByText('Bypass')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run options' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
  fireEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Stop',
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Run options', hidden: true }),
    ).toBeDisabled(),
  );
  expect(stopped).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Run options' })).toBeEnabled(),
  );
});
it('T046 recovers an uncertain trust command then retries the previously refused reply', async () => {
  let trusted = false;
  const { fetcher } = mount('ready', false, (url) => {
    if (url.includes('/receipts/')) {
      trusted = true;
      return json({ ...receipt, operation: 'trust', status: 'done' });
    }
    if (url.endsWith('/projects/trust'))
      return json({ error: 'Unavailable' }, 503);
    return trusted
      ? json(receipt, 202)
      : json(
          { error: 'Untrusted folder', reason: 'untrusted-folder', trust },
          409,
        );
  });
  send();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Trust this folder' }),
  );
  await screen.findByText('Queued');
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) =>
        url.endsWith('/projects/trust') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) => url.endsWith('/messages') && init?.method === 'POST',
    ),
  ).toHaveLength(2);
});

it('T055 mounts and announces GET requests and keeps uncertain decisions locked during receipt recovery', async () => {
  let resolveReceipt!: (value: Response) => void;
  const read = new Promise<Response>((resolve) => {
    resolveReceipt = resolve;
  });
  const { fetcher } = mount(
    'ready',
    false,
    (url) =>
      url.includes('/receipts/') ? read : json({ error: 'Unavailable' }, 503),
    {
      runs: [
        {
          runId: 'r',
          sessionId: 's',
          projectId: 'p',
          state: 'waiting',
          mode: 'default',
          queued: 0,
          ownedByC9view: true,
          startedAt: '2026-11-01',
        },
      ],
      requests: [
        {
          requestId: 'permission',
          runId: 'r',
          sessionId: 's',
          kind: 'permission',
          toolName: 'Read',
          summary: 'Read fixture',
          createdAt: '2026-11-01',
          expiresAt: '2026-11-02',
        },
      ],
    },
  );
  const allow = await screen.findByRole('button', { name: 'Allow' });
  const live = screen.getByText(/1 pending request from Claude/);
  expect(live).toHaveAttribute('aria-live', 'polite');
  // T095: only the tool name is announced, never the summary.
  expect(live).toHaveTextContent('from Claude. Read');
  expect(live).not.toHaveTextContent('Read fixture');
  fireEvent.click(allow);
  await screen.findByText('This may have been sent');
  expect(allow).toBeDisabled();
  fireEvent.click(allow);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toBe('/api/m/remote/control/requests/permission');
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({
    decision: 'allow',
  });
  resolveReceipt(json({ ...receipt, operation: 'decide', status: 'done' }));
  await screen.findByText('Command received.');
  expect(allow).toBeDisabled();
});

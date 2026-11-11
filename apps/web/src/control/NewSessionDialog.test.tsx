import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MachineContext } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { NewSessionDialog } from './NewSessionDialog.js';

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
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function mount(
  bypass = false,
  onPost?: (body: Record<string, unknown>) => Promise<Response> | Response,
  onReceipt?: (url: string) => Promise<Response> | Response,
) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/control/runs')) return json({ runs: [], requests: [] });
    if (url.includes('/control/receipts/'))
      return onReceipt?.(url) ?? json({ error: 'Not found' }, 404);
    if (init?.method === 'POST')
      return (
        onPost?.(JSON.parse(init.body as string) as Record<string, unknown>) ??
        json(
          {
            clientRequestId: 'request',
            bootId: 'boot',
            operation: 'start',
            status: 'accepted',
            sessionId: 'session-returned',
          },
          202,
        )
      );
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'remote',
      bootId: 'boot',
      capabilities: { control: { state: 'ready' }, bypass },
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="remote">
        <NewSessionDialog projectId="project-1" open onOpenChange={() => {}} />
      </MachineContext>
    </QueryClientProvider>,
  );
  return fetcher;
}

it('T057 posts a capped name and navigates to the returned session ID', async () => {
  let finishPost!: (response: Response) => void;
  const fetcher = mount(
    false,
    () => new Promise((resolve) => (finishPost = resolve)),
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Please inspect the project.' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), {
    target: { value: 'N'.repeat(81) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('button', { name: 'Starting…' });
  const [url, init] = fetcher.mock.calls.find(
    ([, request]) => request?.method === 'POST',
  )!;
  expect(url).toBe('/api/m/remote/projects/project-1/sessions');
  expect(JSON.parse(init!.body as string)).toMatchObject({
    text: 'Please inspect the project.',
    name: 'N'.repeat(80),
    permissionMode: 'default',
    clientRequestId: expect.stringMatching(/^[\da-f-]{36}$/),
  });
  finishPost(
    json(
      {
        clientRequestId: 'request',
        bootId: 'boot',
        operation: 'start',
        status: 'accepted',
        sessionId: 'session-returned',
      },
      202,
    ),
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: '/m/$machineId/projects/$projectId/sessions/$sessionId',
      params: {
        machineId: 'remote',
        projectId: 'project-1',
        sessionId: 'session-returned',
      },
      search: { newSession: true },
    }),
  );
});

function accepted(sessionId = 'session-returned') {
  return json(
    {
      clientRequestId: 'request',
      bootId: 'boot',
      operation: 'start',
      status: 'accepted',
      sessionId,
    },
    202,
  );
}

it('T057 shows the machine bypass banner and excludes bypass from the permission menu', () => {
  mount(true);
  expect(
    screen.getByText('This machine bypasses permission prompts for every run.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('combobox', { name: 'Permission mode' }));
  expect(screen.getByRole('option', { name: 'Default' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'Accept edits' })).toBeVisible();
  expect(screen.getByRole('option', { name: 'Plan' })).toBeVisible();
  expect(screen.queryByRole('option', { name: /bypass/i })).toBeNull();
});

it('checks an uncertain start by receipt and never sends a second POST', async () => {
  const fetcher = mount(
    false,
    () => Promise.reject(new TypeError('network timeout')),
    () => accepted('receipt-session'),
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Start carefully.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.some(([url]) => url.includes('/control/receipts/')),
  ).toBe(true);
});

it('uses a fresh client request ID for each manual attempt', async () => {
  const ids: string[] = [];
  let attempts = 0;
  const fetcher = mount(false, (body) => {
    ids.push(body.clientRequestId as string);
    attempts += 1;
    return attempts === 1 ? json({ error: 'Unavailable' }, 500) : accepted();
  });
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Try again.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByText('Unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(ids.every((id) => /^[\da-f-]{36}$/.test(id))).toBe(true);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(2);
});

it('offers folder trust and retries the start as a separate command', async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher = mount(false, (body) => {
    requests.push(body);
    if ('fingerprint' in body)
      return json(
        {
          clientRequestId: body.clientRequestId,
          bootId: 'boot',
          operation: 'trust',
          status: 'done',
        },
        202,
      );
    if (requests.length === 1)
      return json(
        {
          error: 'Folder trust required',
          reason: 'trust-required',
          trust: {
            path: '/workspace/project',
            fingerprint: 'fingerprint',
            hooks: [],
            mcpServers: [],
            allowRules: [],
            plugins: [],
            hasClaudeMd: false,
          },
        },
        409,
      );
    return accepted();
  });
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Start after trust.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('region', { name: 'Folder trust required' });
  fireEvent.click(screen.getByRole('button', { name: 'Trust this folder' }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(requests).toHaveLength(3);
  expect(requests[0]!.clientRequestId).not.toBe(requests[1]!.clientRequestId);
  expect(requests[1]!.clientRequestId).not.toBe(requests[2]!.clientRequestId);
  expect(
    fetcher.mock.calls.some(([url]) => url.endsWith('/projects/trust')),
  ).toBe(true);
});

it('shows a rate limit response', async () => {
  mount(false, () => json({ error: 'Slow down' }, 429));
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Please start.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  expect(await screen.findByText('Slow down')).toBeVisible();
});

it('explains when bypass permission mode is not allowed', async () => {
  mount(false, () =>
    json({ error: 'Not allowed', reason: 'bypass-not-allowed' }, 400),
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Please start.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  expect(
    await screen.findByText(
      'This permission mode is not allowed on the selected machine.',
    ),
  ).toBeVisible();
});

it('shows a failed receipt without navigating', async () => {
  mount(
    false,
    () => Promise.reject(new TypeError('network timeout')),
    () =>
      json({
        clientRequestId: 'request',
        bootId: 'boot',
        operation: 'start',
        status: 'failed',
        error: 'The node could not start the session.',
      }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Please start.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  expect(
    await screen.findByText('The node could not start the session.'),
  ).toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
});

it('clears uncertain receipt state on Cancel and re-open', async () => {
  let finishReceipt!: (response: Response) => void;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/control/runs')) return json({ runs: [], requests: [] });
    if (url.includes('/control/receipts/'))
      return new Promise<Response>((resolve) => (finishReceipt = resolve));
    if (init?.method === 'POST')
      return Promise.reject(new TypeError('network timeout'));
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'remote',
      bootId: 'boot',
      capabilities: { control: { state: 'ready' }, bypass: false },
    },
  ]);
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Re-open session dialog
        </button>
        <NewSessionDialog
          projectId="project-1"
          open={open}
          onOpenChange={setOpen}
        />
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="remote">
        <Harness />
      </MachineContext>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Maybe sent.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByText('This may have been sent. Checking its receipt…');
  await waitFor(() => expect(finishReceipt).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(
    screen.getByRole('button', { name: 'Re-open session dialog' }),
  );
  await screen.findByRole('dialog', { name: 'New session' });
  expect(screen.queryByText('Checking its receipt')).toBeNull();
  await act(async () => {
    finishReceipt(
      json({
        clientRequestId: 'request',
        bootId: 'boot',
        operation: 'start',
        status: 'ready',
        sessionId: 'late-session',
      }),
    );
  });
  expect(navigate).not.toHaveBeenCalled();
});

it('stops polling a non-terminal receipt after the wait cap', async () => {
  vi.useFakeTimers();
  let receiptChecks = 0;
  mount(
    false,
    () => Promise.reject(new TypeError('network timeout')),
    () => {
      receiptChecks += 1;
      return json({
        clientRequestId: 'request',
        bootId: 'boot',
        operation: 'start',
        status: 'running',
      });
    },
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Maybe sent.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(receiptChecks).toBeGreaterThan(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(
    screen.getByText(/This may have been sent\. Check the session/),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled();
  const checksAtCap = receiptChecks;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(receiptChecks).toBe(checksAtCap);
  vi.useRealTimers();
});

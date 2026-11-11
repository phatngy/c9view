import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
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
) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/control/runs')) return json({ runs: [], requests: [] });
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
    }),
  );
});

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

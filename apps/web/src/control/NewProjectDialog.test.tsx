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
import { NewProjectDialog } from './NewProjectDialog.js';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate.mockReset();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const receipt = (extra: object) => ({
  clientRequestId: 'request',
  bootId: 'boot',
  operation: 'project',
  status: 'accepted',
  ...extra,
});
const trust = {
  path: '/w/p',
  fingerprint: 'f'.repeat(64),
  hooks: ['echo hi'],
  mcpServers: [],
  allowRules: [],
  plugins: [],
  hasClaudeMd: true,
};
function mount(
  onPost: (url: string, body: Record<string, unknown>) => Response,
  machines = 1,
  onReceipt?: () => Response,
) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/control/runs'))
        return json({ runs: [], requests: [] });
      if (url.includes('/control/receipts/'))
        return onReceipt?.() ?? json({ error: 'Not found' }, 404);
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        posts.push({ url, body });
        return onPost(url, body);
      }
      throw new Error(`Unexpected ${url}`);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    queryKeys.machines(),
    Array.from({ length: machines }, (_, i) => ({
      machineId: i === 0 ? 'm' : `m${i}`,
      name: `Machine ${i}`,
      bootId: 'boot',
      capabilities: { control: { state: 'ready' }, bypass: false },
    })),
  );
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="m">
        <NewProjectDialog open onOpenChange={() => {}} />
      </MachineContext>
    </QueryClientProvider>,
  );
  return posts;
}
function fill(url = '') {
  fireEvent.change(screen.getByLabelText(/Location/), {
    target: { value: '/w/p' },
  });
  if (url)
    fireEvent.change(screen.getByLabelText(/Git URL/), {
      target: { value: url },
    });
  fireEvent.change(screen.getByLabelText(/First prompt/), {
    target: { value: 'Hello' },
  });
}

it('T074 hides the machine field with one machine and shows it with several', async () => {
  mount(() => json({}), 1);
  expect(screen.queryByRole('combobox', { name: 'Machine' })).toBeNull();
  cleanup();
  mount(() => json({}), 2);
  expect(
    await screen.findByRole('combobox', { name: 'Machine' }),
  ).toBeInTheDocument();
});
it('T074 validates the location and shows the git init option only without a URL', async () => {
  const posts = mount(() => json(receipt({})));
  expect(
    screen.getByRole('checkbox', { name: 'Initialize git' }),
  ).toBeChecked();
  fireEvent.change(screen.getByLabelText(/Git URL/), {
    target: { value: 'https://h.example/o/r.git' },
  });
  expect(screen.queryByRole('checkbox', { name: 'Initialize git' })).toBeNull();
  fireEvent.change(screen.getByLabelText(/Git URL/), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText(/First prompt/), {
    target: { value: 'Hello' },
  });
  expect(
    screen.getByRole('button', { name: 'Create and start' }),
  ).toBeDisabled();
  expect(posts).toHaveLength(0);
});
it('T074 creates a project, navigates to the returned session', async () => {
  const posts = mount(() =>
    json(receipt({ projectId: 'proj', sessionId: 'sess' }), 202),
  );
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(posts[0]!.body).toMatchObject({
    location: '/w/p',
    gitInit: true,
    text: 'Hello',
  });
  expect(posts[0]!.body).not.toHaveProperty('gitUrl');
  expect(navigate.mock.calls[0]![0]).toMatchObject({
    params: { projectId: 'proj', sessionId: 'sess' },
  });
});
it('T074 clone: shows progress, then the trust summary, and starts only after "Trust this folder"', async () => {
  let call = 0;
  const posts = mount(
    (url, body) => {
      if (url.endsWith('/projects/trust'))
        return json(receipt({ operation: 'trust', status: 'done' }));
      call++;
      if (call === 1)
        return json(receipt({ status: 'cloning', projectId: 'proj' }), 202);
      if (call === 2)
        return json(
          { error: 'Trust this folder', reason: 'untrusted-folder', trust },
          409,
        );
      expect(body).not.toHaveProperty('gitUrl');
      return json(receipt({ projectId: 'proj', sessionId: 'sess' }), 202);
    },
    1,
    () => json(receipt({ status: 'ready', projectId: 'proj' })),
  );
  fill('git@h.example:o/r.git');
  fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));
  expect(await screen.findByText(/Cloning repository/)).toBeInTheDocument();
  expect(posts[0]!.body).toMatchObject({ gitUrl: 'git@h.example:o/r.git' });
  const button = await screen.findByRole(
    'button',
    { name: 'Trust this folder' },
    { timeout: 4000 },
  );
  expect(screen.getByText(/Hooks: echo hi/)).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  expect(posts.filter((p) => !p.url.endsWith('/projects/trust'))).toHaveLength(
    2,
  );
  fireEvent.click(button);
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(posts.some((p) => p.url.endsWith('/projects/trust'))).toBe(true);
});
it('T074 reports a bad location from the node', async () => {
  mount(() => json({ error: 'x', reason: 'outside-roots' }, 400));
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Create and start' }));
  expect(
    await screen.findByText(/outside the workspace roots/),
  ).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

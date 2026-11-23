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
import { Composer } from './Composer.js';
import { NewSessionDialog } from './NewSessionDialog.js';
import { NewProjectDialog } from './NewProjectDialog.js';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const MESSAGE = /needs an Anthropic API key \(ANTHROPIC_API_KEY\)/;
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
function mount(
  ui: React.ReactNode,
  availability: object = {
    sessionId: 's',
    available: false,
    reason: 'not-live',
  },
  sdkAuth = 'api-key-required',
) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/control/runs')) return json({ runs: [], requests: [] });
    if (url.endsWith('/remote') && !init?.method) return json(availability);
    return json({ error: 'unexpected' });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'm',
      bootId: 'boot',
      capabilities: { control: { state: 'ready', sdkAuth }, bypass: false },
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="m">{ui}</MachineContext>
    </QueryClientProvider>,
  );
  return fetcher;
}
const box = () => screen.getByRole('textbox', { name: 'Reply to session' });

it('T117 the composer for a non-live session shows the message and disables send', async () => {
  mount(<Composer projectId="p" sessionId="s" />);
  expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  expect(box()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});
it('T117 the composer for a live terminal session stays enabled', async () => {
  mount(<Composer projectId="p" sessionId="s" />, {
    sessionId: 's',
    available: true,
    sessionState: 'idle',
    checkedAt: '2026-11-17T00:00:00.000Z',
  });
  await screen.findByRole('button', { name: 'Send to the terminal session' });
  expect(screen.queryByText(MESSAGE)).toBeNull();
  expect(box()).toBeEnabled();
  fireEvent.change(box(), { target: { value: 'hello' } });
  expect(
    screen.getByRole('button', { name: 'Send to the terminal session' }),
  ).toBeEnabled();
});
it('T117 the composer is unchanged when the node has an API-key method', async () => {
  mount(<Composer projectId="p" sessionId="s" />, undefined, 'ok');
  await waitFor(() => expect(box()).toBeEnabled());
  expect(screen.queryByText(MESSAGE)).toBeNull();
});
it('T117 New session shows the message and disables Start session', async () => {
  mount(<NewSessionDialog projectId="p" open onOpenChange={() => {}} />);
  expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), {
    target: { value: 'Hello' },
  });
  expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
});
it('T117 New project shows the message and disables Create and start', async () => {
  mount(<NewProjectDialog open onOpenChange={() => {}} />);
  expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Location/), {
    target: { value: '/w/p' },
  });
  fireEvent.change(screen.getByLabelText(/First prompt/), {
    target: { value: 'Hello' },
  });
  expect(
    screen.getByRole('button', { name: 'Create and start' }),
  ).toBeDisabled();
});

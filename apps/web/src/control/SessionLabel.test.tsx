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
import { SessionLabel, SessionTitle } from './SessionLabel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function mount(
  ready: boolean,
  labels: { projectId: string; sessionId: string; label: string }[] = [],
) {
  const posts: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/labels')) return json({ labels });
    if (url.endsWith('/control/runs')) return json({ runs: [], requests: [] });
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return json({
        clientRequestId: 'c',
        bootId: 'boot',
        operation: 'label',
        status: 'done',
      });
    }
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'm',
      bootId: 'boot',
      capabilities: {
        control: { state: ready ? 'ready' : 'off' },
        bypass: false,
      },
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="m">
        <h1>
          <SessionTitle projectId="p" sessionId="s" title="Original title" />
        </h1>
        <SessionLabel projectId="p" sessionId="s" />
      </MachineContext>
    </QueryClientProvider>,
  );
  return { fetcher, posts };
}

it('T079 a label replaces the title with the "label in c9view" tooltip', async () => {
  mount(true, [{ projectId: 'p', sessionId: 's', label: 'Mine' }]);
  const label = await screen.findByText('Mine');
  expect(label).toHaveAttribute('title', 'label in c9view');
  expect(screen.queryByText('Original title')).toBeNull();
});
it('T079 shows no label and no editor with control off', () => {
  const { fetcher } = mount(false, [
    { projectId: 'p', sessionId: 's', label: 'Mine' },
  ]);
  expect(screen.getByText('Original title')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /label/i })).toBeNull();
  expect(fetcher).not.toHaveBeenCalledWith(
    expect.stringContaining('/labels'),
    undefined,
  );
});
it('T079 edits inline from the keyboard, saves on Enter and cancels on Escape', async () => {
  const { posts } = mount(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Add label' }));
  const input = await screen.findByRole('textbox', { name: 'c9view label' });
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add label' })).toHaveFocus(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add label' }));
  const again = await screen.findByRole('textbox', { name: 'c9view label' });
  fireEvent.change(again, { target: { value: '  Renamed ' } });
  fireEvent.submit(again.closest('form')!);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ label: 'Renamed' });
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
});
it('T079 an empty label is sent to remove it', async () => {
  const { posts } = mount(true, [
    { projectId: 'p', sessionId: 's', label: 'Mine' },
  ]);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit label' }));
  const input = await screen.findByRole('textbox', { name: 'c9view label' });
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(posts[0]).toMatchObject({ label: '' }));
});

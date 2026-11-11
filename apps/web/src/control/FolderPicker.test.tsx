import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MachineContext } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { FolderPicker } from './FolderPicker.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
it('T074 lists roots, descends one level at a time, goes up and keeps the path in sync, from the keyboard', async () => {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/control/runs'))
        return json({ runs: [], requests: [] });
      if (url.includes('path=%2Fw%2Fa'))
        return json({
          path: '/w/a',
          parent: '/w',
          entries: [{ name: 'deep', path: '/w/a/deep' }],
          truncated: false,
        });
      if (url.includes('path=%2Fw'))
        return json({
          path: '/w',
          entries: [{ name: 'a', path: '/w/a' }],
          truncated: false,
        });
      return json({ entries: [{ name: '/w', path: '/w' }], truncated: false });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'm',
      bootId: 'b',
      capabilities: { control: { state: 'ready' }, bypass: false },
    },
  ]);
  const changes: string[] = [];
  render(
    <QueryClientProvider client={client}>
      <MachineContext value="m">
        <FolderPicker onChange={(path) => changes.push(path)} />
      </MachineContext>
    </QueryClientProvider>,
  );
  const root = await screen.findByText('/w', { selector: 'span' });
  fireEvent.click(root);
  const folder = await screen.findByText('a');
  expect(screen.getByLabelText('Up one level')).toBeEnabled();
  fireEvent.click(folder);
  await screen.findByText('deep');
  fireEvent.click(screen.getByLabelText('Up one level'));
  expect(changes).toEqual(['/w', '/w/a', '/w']);
  fireEvent.click(screen.getByLabelText('Show hidden'));
  await screen.findByText('a');
  expect(urls.some((u) => u.includes('hidden=1'))).toBe(true);
});

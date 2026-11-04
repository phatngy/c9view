import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, HttpError } from '../api.js';
import { overview } from '../test-fixtures.js';
import { UsageSection } from './UsageSection.js';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('shows a calm placeholder while the index is building', async () => {
  vi.spyOn(api, 'usage').mockRejectedValue(
    new HttpError('Charts are available once indexing finishes', 503),
  );
  vi.spyOn(api, 'overview').mockResolvedValue(overview);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <UsageSection range={30} />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText('Charts are available once indexing finishes'),
  ).toBeVisible();
  client.clear();
});

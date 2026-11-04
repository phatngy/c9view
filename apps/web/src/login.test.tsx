import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginGate } from './login.js';
import { api } from './api.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('replaces the app with token instructions on an API 401', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Login required', auth: 'token' }),
          { status: 401 },
        ),
      ),
  );
  render(
    <LoginGate>
      <p>Dashboard</p>
    </LoginGate>,
  );
  await act(async () => {
    await expect(api.projects()).rejects.toMatchObject({ status: 401 });
  });
  expect(screen.getByLabelText('Token')).toBeInTheDocument();
  expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
});
it('shows a password form and submits JSON, reporting rate limits', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
  vi.stubGlobal('fetch', fetch);
  render(
    <LoginGate>
      <p>Dashboard</p>
    </LoginGate>,
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent('c9view:login', { detail: 'password' }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'fixture-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts'),
  );
  expect(fetch).toHaveBeenCalledWith('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'fixture-password' }),
  });
});

it('submits a pasted token and reports the backoff time', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }),
    );
  vi.stubGlobal('fetch', fetch);
  render(
    <LoginGate>
      <p>Dashboard</p>
    </LoginGate>,
  );
  act(() =>
    window.dispatchEvent(new CustomEvent('c9view:login', { detail: 'token' })),
  );
  fireEvent.change(screen.getByLabelText('Token'), {
    target: { value: 'synthetic+token' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Try again in 2 seconds.',
    ),
  );
  expect(fetch).toHaveBeenCalledWith('/login?token=synthetic%2Btoken', {});
});

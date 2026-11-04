import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import {
  authMode,
  createAuth,
  normalizeBindHost,
  validateExposure,
  type AuthMode,
} from './index.js';
import { createApp } from '../app.js';

function protectedApp(options: Parameters<typeof createAuth>[0]) {
  const auth = createAuth(options);
  const app = new Hono();
  app.use('*', auth.middleware);
  app.get('/private', (c) => c.text('private'));
  app.get('/api/events', (c) =>
    c.body('data: private\n\n', 200, { 'Content-Type': 'text/event-stream' }),
  );
  app.get('/login', (c) => c.text('login screen'));
  return { app, auth };
}
const cookieOf = (response: Response) =>
  response.headers.get('set-cookie')!.split(';')[0]!;

describe('login boundary', () => {
  it('requires auth even for loopback, unknown routes and streams', async () => {
    const { app } = protectedApp({ mode: 'token' });
    for (const path of ['/private', '/api/events', '/unknown']) {
      expect((await app.request(`http://127.0.0.1${path}`)).status).toBe(401);
    }
    expect(
      (
        await app.request('/private', { headers: { Accept: 'text/html' } })
      ).headers.get('location'),
    ).toBe('/login');
  });
  it('logs in with a token, rejects malformed signatures, and resets sessions on restart', async () => {
    let time = 0;
    const { app, auth } = protectedApp({ mode: 'token', now: () => time });
    expect(auth.token).toHaveLength(64);
    for (const token of ['', 'wrong', 'x'.repeat(1000)]) {
      expect((await app.request(`/login?token=${token}`)).status).toBe(401);
      time += 60_000;
    }
    const response = await app.request(`/login?token=${auth.token}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Strict/);
    expect(response.headers.get('set-cookie')).toMatch(/Path=\//);
    const cookie = cookieOf(response);
    expect(
      (await app.request('/private', { headers: { cookie } })).status,
    ).toBe(200);
    expect(
      (await app.request('/api/events', { headers: { cookie } })).status,
    ).toBe(200);
    expect(
      (await app.request('/private', { headers: { cookie: cookie + 'x' } }))
        .status,
    ).toBe(401);
    expect(
      (
        await protectedApp({ mode: 'token', token: auth.token! }).app.request(
          '/private',
          { headers: { cookie } },
        )
      ).status,
    ).toBe(401);
  });
  it('trusts forwarded https only with explicit proxy trust', async () => {
    for (const trustProxy of [false, true]) {
      const { app } = protectedApp({
        mode: 'token',
        token: 'f'.repeat(32),
        trustProxy,
      });
      const response = await app.request(`/login?token=${'f'.repeat(32)}`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      expect(response.headers.get('set-cookie')!.includes('Secure')).toBe(
        trustProxy,
      );
    }
  });
  it('hashes passwords, backs off after failures, resets on success, and expires sessions', async () => {
    let time = 0;
    const { app } = protectedApp({
      mode: 'password',
      password: 'fixture-password',
      now: () => time,
    });
    const post = (password: unknown) =>
      app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    expect(
      (await app.request('/api/login', { method: 'POST', body: '{}' })).status,
    ).toBe(415);
    for (const value of ['', 'wrong', 1, null, 'x'.repeat(5000)]) {
      expect((await post(value)).status).toBe(401);
      expect((await post('fixture-password')).status).toBe(429);
      time += 60_000;
    }

    const response = await post('fixture-password');
    expect(response.status).toBe(200);
    const cookie = cookieOf(response);
    expect(
      (await app.request('/private', { headers: { cookie } })).status,
    ).toBe(200);
    time += 24 * 60 * 60 * 1000;
    expect(
      (await app.request('/private', { headers: { cookie } })).status,
    ).toBe(401);
    expect(() => createAuth({ mode: 'password' })).toThrow('C9VIEW_PASSWORD');
  });
  it('short circuits real health enrichment and keeps Host/Origin protection on login', async () => {
    const auth = createAuth({ mode: 'password', password: 'fixture' });
    const app = createApp(
      loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/missing' }),
      { auth: auth.middleware },
    );
    const health = await app.request('/api/health');
    expect(await health.json()).toEqual({
      ok: true,
      version: '0.0.0',
      auth: 'required',
    });
    const response = await app.request('/api/login', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: 'fixture' }),
    });
    expect(response.status).toBe(403);
    expect(
      (await app.request('/login', { headers: { Host: 'evil.example' } }))
        .status,
    ).toBe(403);
  });
});

it('enforces the startup host × extra hosts × auth matrix', () => {
  for (const host of [
    '127.0.0.1',
    '::1',
    'localhost',
    '0.0.0.0',
    '::',
    'dashboard.internal',
  ]) {
    for (const hosts of [[], ['tunnel.example']]) {
      for (const mode of ['none', 'token', 'password'] as AuthMode[]) {
        const run = () => validateExposure(host, hosts, mode);
        if (
          mode === 'none' &&
          (hosts.length || !['127.0.0.1', '::1', 'localhost'].includes(host))
        )
          expect(run).toThrow('require login');
        else expect(run).not.toThrow();
      }
    }
  }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(() =>
      validateExposure('0.0.0.0', ['tunnel.example'], 'none', true),
    ).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('UNSAFE behind tunnels'),
    );
  } finally {
    warning.mockRestore();
  }
});

it('validates token strength and gives concise auth errors', () => {
  for (const token of ['', 'a', 'x'.repeat(31)])
    expect(() => createAuth({ mode: 'token', token })).toThrow('at least 32');
  expect(() =>
    createAuth({ mode: 'token', token: 'x'.repeat(32) }),
  ).not.toThrow();
  expect(() => authMode('invalid')).toThrow(
    'C9VIEW_AUTH must be one of: none, token, password',
  );
  expect(normalizeBindHost('[::1]')).toBe('::1');
  expect(() => validateExposure('[::1]', [], 'none')).not.toThrow();
});

it('lets a correct token log in during backoff and still throttles wrong tokens', async () => {
  vi.useFakeTimers();
  try {
    const { app, auth } = protectedApp({ mode: 'token' });
    const wrong = () => app.request('/login?token=wrong');
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(429);
    const success = await app.request(`/login?token=${auth.token}`);
    expect(success.status).toBe(302);
    expect((await wrong()).status).toBe(401);
    expect((await wrong()).status).toBe(429);
  } finally {
    vi.useRealTimers();
  }
});

it('uses timed exponential backoff for passwords and resets after success', async () => {
  vi.useFakeTimers();
  try {
    const { app } = protectedApp({ mode: 'password', password: 'correct' });
    const request = (good = false) =>
      app.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: good ? 'correct' : 'wrong' }),
      });
    for (const seconds of [1, 2, 4, 8, 16, 32, 60, 60]) {
      expect((await request()).status).toBe(401);
      const blocked = await request(true);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBe(String(seconds));
      vi.advanceTimersByTime(seconds * 1000 - 1);
      expect((await request()).status).toBe(429);
      vi.advanceTimersByTime(1);
    }
    for (let i = 0; i < 65; i++) expect((await request(true)).status).toBe(200);
    expect((await request()).status).toBe(401);
    expect((await request()).headers.get('Retry-After')).toBe('1');
  } finally {
    vi.useRealTimers();
  }
  // About 90 logins each run a deliberately slow scrypt hash: ~2 s locally,
  // over the 5 s default on slow CI runners.
}, 30_000);

it('caps failures globally across trusted client keys and expires the rolling window', async () => {
  vi.useFakeTimers();
  try {
    const { app, auth } = protectedApp({ mode: 'token', trustProxy: true });
    const request = (ip: string, token = 'wrong') =>
      app.request(`/login?token=${token}`, {
        headers: { 'X-Forwarded-For': `${ip}, proxy` },
      });
    for (let i = 0; i < 60; i++)
      expect((await request(`client-${i}`)).status).toBe(401);
    expect((await request('new-client', auth.token)).status).toBe(302);
    vi.advanceTimersByTime(60_000);
    expect((await request('new-client', auth.token)).status).toBe(302);
  } finally {
    vi.useRealTimers();
  }
});

it('ignores forwarded identities unless proxy trust is enabled', async () => {
  for (const trustProxy of [false, true]) {
    const { app } = protectedApp({ mode: 'token', trustProxy });
    expect(
      (
        await app.request('/login?token=wrong', {
          headers: { 'X-Forwarded-For': 'client-one' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request('/login?token=wrong', {
          headers: { 'X-Forwarded-For': 'client-two' },
        })
      ).status,
    ).toBe(trustProxy ? 401 : 429);
  }
});

// 61 logins each run a synchronous scrypt, which can take more than the
// default 5 s on a loaded CI runner.
it('enforces the global password cap even for concurrent body reads', async () => {
  const { app } = protectedApp({
    mode: 'password',
    password: 'correct',
    trustProxy: true,
  });
  const responses = await Promise.all(
    Array.from({ length: 61 }, (_, index) =>
      app.request('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `client-${index}`,
        },
        body: JSON.stringify({ password: 'wrong' }),
      }),
    ),
  );
  expect(responses.filter((response) => response.status === 401)).toHaveLength(
    60,
  );
  expect(responses.filter((response) => response.status === 429)).toHaveLength(
    1,
  );
}, 20_000);

import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import { createNodeHello, type NodeTransport } from '@c9view/node';
import { createApp } from '../app.js';
import { createAuth } from '../auth/index.js';

const bootId = '00000000-0000-4000-8000-000000000001';
const token = 'synthetic-token-123456789012345678901234';
const paths = [
  '/api/control/runs/run/stop',
  '/api/m/local/control/runs/run/stop',
];
async function setup() {
  // A node app is only fetched in process: it owns no HTTP listener.
  const node = new Hono();
  const acted = vi.fn();
  node.post('/control/runs/run/stop', (c) => {
    acted();
    return c.json({ ok: true });
  });
  const request = vi.fn<NodeTransport['request']>(async (envelope) => {
    const result = await node.request(envelope.path, {
      method: envelope.method,
    });
    return {
      status: result.status,
      contentType: 'application/json',
      body: (async function* () {
        yield new Uint8Array(await result.arrayBuffer());
      })(),
    };
  });
  const transport: NodeTransport = {
    machineId: 'local',
    hello: createNodeHello,
    request,
    subscribe: () => () => {},
    snapshot: async () => ({ projects: [], sessions: [], control: [] }),
    close: () => {},
  };
  const auth = createAuth({ mode: 'token', token });
  const app = createApp(
    loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/claude' }),
    { transport, auth: auth.middleware, authMode: 'token' },
  );
  const login = await app.request(`/login?token=${token}`);
  const headers = {
    origin: 'http://localhost',
    'content-type': 'application/json; charset=utf-8',
    'x-c9view-control': '1',
    'x-c9view-boot-id': bootId,
    cookie: login.headers.get('set-cookie')!.split(';')[0]!,
  };
  return { app, request, acted, headers };
}

it.each(paths)('guards %s before contacting the node', async (path) => {
  const { app, request, headers } = await setup();
  for (const [key, value] of [
    ['origin', undefined],
    ['origin', 'https://foreign.invalid'],
    ['origin', 'null'],
    ['x-c9view-control', undefined],
    ['x-c9view-control', '0'],
    ['content-type', undefined],
    ['content-type', 'text/plain'],
    ['cookie', undefined],
    ['cookie', 'c9view_session=forged'],
    ['x-c9view-boot-id', undefined],
    ['x-c9view-boot-id', 'not-a-uuid'],
  ] as const) {
    const invalid: Record<string, string> = { ...headers };
    if (value === undefined) delete invalid[key];
    else invalid[key] = value;
    const result = await app.request(path, {
      method: 'POST',
      headers: invalid,
      body: '{}',
    });
    expect(result.status, `${key}=${value}`).toBe(403);
    expect(await result.json()).toEqual({ error: 'Forbidden' });
  }
  expect(request).not.toHaveBeenCalled();
  const accepted = await app.request(path, {
    method: 'POST',
    headers: {
      ...headers,
      authorization: 'Bearer never-forward',
      'x-extra': 'never-forward',
    },
    body: '{}',
  });
  expect(accepted.status).toBe(200);
  expect(request.mock.calls[0]![0]).toEqual({
    method: 'POST',
    path: '/control/runs/run/stop',
    query: {},
    body: new TextEncoder().encode('{}'),
    clientBootId: bootId,
  });
});

it('requires login even when auth is none or only a cookie is supplied', async () => {
  const { headers } = await setup();
  const app = createApp(
    loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/claude' }),
    {
      transport: {
        machineId: 'local',
        hello: createNodeHello,
        request: vi.fn(),
        subscribe: () => () => {},
        snapshot: async () => ({ projects: [], sessions: [], control: [] }),
        close: () => {},
      },
    },
  );
  expect(
    (await app.request(paths[0]!, { method: 'POST', headers, body: '{}' }))
      .status,
  ).toBe(403);
});

it('exposes control only through the hub listener and supplies no cross-site preflight', async () => {
  const { app, request, acted, headers } = await setup();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const base = `http://127.0.0.1:${address.port}`;
    expect(
      (
        await fetch(`${base}/control/runs/run/stop`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(404);
    const preflight = await fetch(`${base}${paths[0]}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://foreign.invalid',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(acted).not.toHaveBeenCalled();
    expect(
      (
        await fetch(`${base}${paths[0]}`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(200);
    expect(acted).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('keeps GET requests outside the mutation guard and omits clientBootId', async () => {
  const { app, request, headers } = await setup();
  await app.request('/api/m/local/control/runs', {
    headers: { cookie: headers.cookie },
  });
  expect(request).toHaveBeenCalledWith(
    { method: 'GET', path: '/control/runs', query: {} },
    expect.any(AbortSignal),
  );
});

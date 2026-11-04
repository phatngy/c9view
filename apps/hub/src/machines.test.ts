import { hostname } from 'node:os';
import { request } from 'node:http';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';
import { loadConfig, VERSION } from '@c9view/core';
import {
  createNodeHello,
  DEFAULT_NODE_LIMITS,
  type NodeTransport,
} from '@c9view/node';
import { Machines } from './machines.js';
import { createApp } from './app.js';
import { createAuth } from './auth/index.js';

const config = loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/claude' });
function setup(options: Partial<Parameters<typeof createApp>[1]> = {}) {
  const hello = createNodeHello();
  const transport: NodeTransport = {
    machineId: 'untrusted',
    hello: () => hello,
    request: vi.fn(async (request) => ({
      status: 200,
      contentType: 'application/json',
      body: (async function* () {
        yield new TextEncoder().encode(
          JSON.stringify(
            request.path === '/health'
              ? {
                  version: VERSION,
                  claudeDir: '/synthetic/claude',
                  index: {},
                  hooks: {},
                }
              : request,
          ),
        );
      })(),
    })),
    subscribe: vi.fn(() => () => {}),
    snapshot: async () => ({ projects: [], sessions: [], control: [] }),
    close: () => {},
  };
  return {
    transport,
    hello,
    app: createApp(config, { transport, ...options }),
  };
}

it('lists local using hello and keeps hub-owned routes ahead of the alias', async () => {
  const { app, transport, hello } = setup();
  expect(await (await app.request('/api/machines')).json()).toEqual([
    {
      ...hello,
      machineId: 'local',
      name: hostname(),
      state: 'online',
      lastSeenAt: null,
      protocol: 1,
      outdated: false,
      capabilities: { control: { state: 'off' }, bypass: false },
    },
  ]);
  expect(transport.request).not.toHaveBeenCalled();
  expect(await (await app.request('/api/health')).json()).toEqual({
    ok: true,
    version: VERSION,
    auth: 'none',
    machines: 1,
    claudeDir: '/synthetic/claude',
    index: {},
    hooks: {},
  });
  const events = await app.request('/api/events');
  expect(events.headers.get('content-type')).toBe('text/event-stream');
  await events.body?.cancel();
  expect(transport.request).toHaveBeenCalledTimes(1);
  const nodeHealth = await (await app.request('/api/m/local/health')).json();
  expect(nodeHealth).not.toHaveProperty('ok');
  expect(nodeHealth).not.toHaveProperty('machines');
});

it.each(['GET', 'POST', 'HEAD'])(
  'relays %s identically through alias and scoped paths',
  async (method) => {
    const { app, transport } = setup({
      authMode: 'token',
      auth: async (_c, next) => next(),
    });
    const init = {
      method,
      ...(method === 'POST'
        ? {
            body: 'fixture',
            headers: {
              origin: 'http://localhost',
              'content-type': 'application/json',
              'x-c9view-control': '1',
              'x-c9view-boot-id': '00000000-0000-4000-8000-000000000001',
            },
          }
        : {}),
    };
    const alias = await app.request('/api/projects?q=a%26b', init);
    const scoped = await app.request('/api/m/local/projects?q=a%26b', init);
    expect(scoped.status).toBe(alias.status);
    expect(await scoped.text()).toBe(await alias.text());
    const calls = vi.mocked(transport.request).mock.calls;
    expect(calls[1]?.[0]).toEqual(calls[0]?.[0]);
  },
);

it('returns 404 for unknown machines without contacting local', async () => {
  const { app, transport } = setup();
  for (const path of ['/api/m/nope/overview', '/api/m/nope', '/api/m']) {
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  }
  expect(transport.request).not.toHaveBeenCalled();
});

it.each([
  '__proto__',
  'constructor',
  'toString',
  '%2F',
  '%2e%2e',
  'x'.repeat(1_000),
])('rejects machine id %s without contacting local', async (id) => {
  const { app, transport } = setup();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    // node:http preserves encoded dot segments; fetch/Request normalize them.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: `/api/m/${id}/projects`,
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        },
      );
      req.once('error', reject);
      req.end();
    });
    expect(status).toBe(404);
    expect(transport.request).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('returns an empty scoped HEAD response with the GET content type', async () => {
  const { app, transport } = setup();
  const get = await app.request('/api/m/local/projects');
  const head = await app.request('/api/m/local/projects', { method: 'HEAD' });
  expect(get.status).toBe(200);
  expect(head.status).toBe(200);
  expect(head.headers.get('content-type')).toBe('application/json');
  expect(head.headers.get('content-type')).toBe(
    get.headers.get('content-type'),
  );
  expect(await head.text()).toBe('');
  expect(vi.mocked(transport.request).mock.calls[1]?.[0].method).toBe('GET');
});

it('returns no machines or alias data without a local node, while hub routes work', async () => {
  const app = createApp(config, { transport: null });
  for (const path of ['/api/overview', '/api/m/local/overview'])
    expect((await app.request(path)).status).toBe(404);
  expect(await (await app.request('/api/machines')).json()).toEqual([]);
  expect(await (await app.request('/api/health')).json()).toEqual({
    ok: true,
    version: VERSION,
    auth: 'none',
    machines: 0,
  });
  const events = await app.request('/api/events');
  expect(events.status).toBe(200);
  await events.body?.cancel();
});

it('applies login, Host and Origin checks equally to scoped and alias requests', async () => {
  const auth = createAuth({
    mode: 'token',
    token: 'fixture-token-12345678901234567890',
  });
  const { app, transport } = setup({
    auth: auth.middleware,
    authMode: 'token',
  });
  for (const path of [
    '/api/projects',
    '/api/m/local/projects',
    '/api/machines',
    '/api/events',
  ]) {
    expect((await app.request(path)).status).toBe(401);
    expect(
      (await app.request(path, { headers: { host: 'evil.invalid' } })).status,
    ).toBe(403);
    expect(
      (await app.request(path, { headers: { origin: 'https://evil.invalid' } }))
        .status,
    ).toBe(403);
  }
  expect(transport.request).not.toHaveBeenCalled();
  const login = await app.request(
    '/login?token=fixture-token-12345678901234567890',
  );
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  for (const path of ['/api/projects', '/api/m/local/projects'])
    expect((await app.request(path, { headers: { cookie } })).status).toBe(200);
  expect(
    await (await app.request('/api/health', { headers: { cookie } })).json(),
  ).toHaveProperty('auth', 'token');
});

it('bounds scoped POST bodies before calling the node', async () => {
  const { app, transport } = setup({
    limits: { ...DEFAULT_NODE_LIMITS, requestBodyMaxBytes: 4 },
    authMode: 'token',
    auth: async (_c, next) => next(),
  });
  expect(
    (
      await app.request('/api/m/local/control', {
        method: 'POST',
        body: '12345',
        headers: {
          origin: 'http://localhost',
          'content-type': 'application/json',
          'x-c9view-control': '1',
          'x-c9view-boot-id': '00000000-0000-4000-8000-000000000001',
        },
      })
    ).status,
  ).toBe(413);
  expect(transport.request).not.toHaveBeenCalled();
});

it('returns the offline response for a known machine without calling a transport', async () => {
  const { app, transport, hello } = setup();
  const lookup = vi.spyOn(Machines.prototype, 'get').mockReturnValue({
    summary: {
      ...hello,
      machineId: 'paired',
      state: 'offline',
      lastSeenAt: null,
      outdated: false,
    },
    transport: null,
  });
  try {
    const response = await app.request('/api/m/paired/overview');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Machine offline',
      reason: 'offline',
    });
    expect(transport.request).not.toHaveBeenCalled();
  } finally {
    lookup.mockRestore();
  }
});

it.each(['ready', 'unavailable'] as const)(
  'preserves control %s, its reason and bypass in machine listings',
  async (state) => {
    const hello = createNodeHello();
    hello.capabilities = {
      control: { state, reason: 'synthetic capability reason' },
      bypass: true,
    };
    const transport = { hello: () => hello } as NodeTransport;
    const app = createApp(config, { transport, authMode: 'token' });
    const machines = await (await app.request('/api/machines')).json();
    expect(machines[0].capabilities).toEqual(hello.capabilities);
  },
);

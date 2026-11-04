import { expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import {
  createNodeHello,
  type NodeTransport,
  type NodeResponse,
} from '@c9view/node';
import { createApp } from './app.js';

function setup(response: NodeResponse) {
  const transport: NodeTransport = {
    machineId: 'local',
    hello: createNodeHello,
    request: vi.fn(async () => response),
    subscribe: () => () => {},
    snapshot: async () => ({ projects: [], sessions: [], control: [] }),
    close: () => {},
  };
  return {
    transport,
    app: createApp(loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/claude' }), {
      transport,
    }),
  };
}

it('relays only the method, node path, query and POST body, preserving response bytes', async () => {
  const encoder = new TextEncoder();
  const { app, transport } = setup({
    status: 202,
    contentType: 'application/octet-stream',
    body: (async function* () {
      yield encoder.encode('first');
      yield encoder.encode('second');
    })(),
  });
  const response = await app.request('/api/control?value=a%26b', {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      cookie: 'secret=fixture',
      authorization: 'Bearer fixture',
      'x-browser-header': 'fixture',
    },
    body: '{"fixture":true}',
  });
  expect(response.status).toBe(202);
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(await response.text()).toBe('firstsecond');
  expect(transport.request).toHaveBeenCalledWith(
    {
      method: 'POST',
      path: '/control',
      query: { value: 'a&b' },
      body: encoder.encode('{"fixture":true}'),
    },
    expect.any(AbortSignal),
  );
});

it('passes browser aborts to the transport and omits bodies from GET envelopes', async () => {
  const { app, transport } = setup({
    status: 200,
    contentType: 'application/json',
    body: (async function* () {
      yield new TextEncoder().encode('{}');
    })(),
  });
  const controller = new AbortController();
  const response = await app.request('/api/projects', {
    signal: controller.signal,
  });
  expect(transport.request).toHaveBeenCalledWith(
    { method: 'GET', path: '/projects', query: {} },
    expect.any(AbortSignal),
  );
  const signal = vi.mocked(transport.request).mock.calls[0]![1];
  expect(signal.aborted).toBe(false);
  controller.abort();
  expect(signal.aborted).toBe(true);
  await response.body?.cancel();
});

it('preserves node health failures without adding success fields', async () => {
  const { app } = setup({
    status: 504,
    contentType: 'application/json',
    body: (async function* () {
      yield new TextEncoder().encode('{"error":"Gateway timeout"}');
    })(),
  });
  const response = await app.request('/api/health');
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({ error: 'Gateway timeout' });
});

it('relays HEAD as GET and returns the node status and content type without a body', async () => {
  const { app, transport } = setup({
    status: 200,
    contentType: 'application/json',
    body: (async function* () {
      yield new TextEncoder().encode('{"projects":[]}');
    })(),
  });
  const get = await app.request('/api/projects');
  const head = await app.request('/api/projects', { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-type')).toBe(
    get.headers.get('content-type'),
  );
  expect(await head.text()).toBe('');
  expect(transport.request).toHaveBeenLastCalledWith(
    { method: 'GET', path: '/projects', query: {} },
    expect.any(AbortSignal),
  );

  const unknownApp = setup({
    status: 404,
    contentType: 'application/json',
    body: (async function* () {
      yield new TextEncoder().encode('{"error":"Not found"}');
    })(),
  }).app;
  const unknown = await unknownApp.request('/api/unknown', { method: 'HEAD' });
  expect(unknown.status).toBe(404);
  expect(await unknown.text()).toBe('');
});

it('limits POST bodies before relaying, including chunked bodies', async () => {
  vi.stubEnv('C9VIEW_REQUEST_BODY_MAX_BYTES', '4');
  try {
    const { app, transport } = setup({
      status: 404,
      contentType: 'application/json',
      body: (async function* () {
        yield new TextEncoder().encode('{"error":"Not found"}');
      })(),
    });
    const exactLimit = await app.request('/api/unknown', {
      method: 'POST',
      body: '1234',
    });
    expect(exactLimit.status).toBe(404);
    expect(vi.mocked(transport.request).mock.calls[0]?.[0].body).toEqual(
      new TextEncoder().encode('1234'),
    );

    const overLimit = await app.request('/api/unknown', {
      method: 'POST',
      body: '12345',
    });
    expect(overLimit.status).toBe(413);
    expect(await overLimit.json()).toEqual({
      error: 'Request body too large',
    });
    expect(transport.request).toHaveBeenCalledTimes(1);

    let cancelled = false;
    let pulls = 0;
    const chunked = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(3));
      },
      cancel() {
        cancelled = true;
      },
    });
    const chunkedResponse = await app.request('/api/unknown', {
      method: 'POST',
      body: chunked,
      duplex: 'half',
    } as RequestInit);
    expect(chunkedResponse.status).toBe(413);
    expect(await chunkedResponse.json()).toEqual({
      error: 'Request body too large',
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(3);
    expect(transport.request).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllEnvs();
  }
});

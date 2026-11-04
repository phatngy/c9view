import { eventRoutes } from './routes/events.js';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { HttpBindings } from '@hono/node-server';
import { redactText } from '@c9view/core';
import type { ApiError } from '@c9view/api';
import {
  DataStore,
  createNode,
  createNodeHello,
  loadNodeLimits,
  type NodeLimits,
  type NodeTransport,
  type ServerConfig,
} from '@c9view/node';
import { Machines, machineRoutes } from './machines.js';
import type { AuthMode } from './auth/index.js';
import { transportResponse } from './relay.js';
import { healthRoutes } from './routes/health.js';
import { createLocalTransport } from './local-node.js';

export function createApp(
  config: ServerConfig,
  options: {
    store?: DataStore;
    transport?: NodeTransport | null;
    authMode?: AuthMode;
    limits?: NodeLimits;
    webDist?: string;
    auth?: MiddlewareHandler;
    allowedHosts?: string[];
  } = {},
) {
  const app = new Hono();
  const limits = options.limits ?? loadNodeLimits();
  const runtime =
    options.transport !== undefined
      ? undefined
      : options.store
        ? {
            store: options.store,
            events: options.store.events,
            hello: createNodeHello(),
          }
        : createNode(config);
  const transport =
    options.transport === undefined
      ? createLocalTransport(runtime!, limits)
      : options.transport;
  const machines = new Machines(transport);
  const allowed = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    ...(options.allowedHosts ?? []).map(normalizeHostname),
    ...(process.env.HOST ? [normalizeHostname(process.env.HOST)] : []),
    ...(process.env.C9VIEW_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((value) => normalizeHostname(value.trim()))
      .filter(Boolean),
  ]);
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    const hostname = authorityHostname(host);
    const origin = c.req.header('origin');
    let originHost: string | null = null;
    if (origin !== undefined) {
      try {
        const url = new URL(origin);
        if (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password
        )
          originHost = url.hostname.toLowerCase();
      } catch {
        /* Malformed origins are rejected. */
      }
    }
    if (
      !hostname ||
      !allowed.has(hostname) ||
      (origin !== undefined && (!originHost || !allowed.has(originHost)))
    )
      return c.json({ error: 'Forbidden' } satisfies ApiError, 403);
    await next();
  });
  // Authentication applies before every route, including health enrichment and streams.
  if (options.auth) app.use('*', options.auth);

  app.use('/api/*', async (c, next) => {
    // The HTTP adapter normalizes encoded dot segments in Request.url. Check
    // the original target too, before an unknown machine can become an alias.
    const incoming = (c.env as Partial<HttpBindings> | undefined)?.incoming;
    const rawId = /^(?:https?:\/\/[^/]+)?\/api\/m\/([^/?]+)/.exec(
      incoming?.url ?? c.req.url,
    )?.[1];
    if (rawId && !machines.get(rawId))
      return c.json({ error: 'Not found' } satisfies ApiError, 404);
    await next();
  });

  app.onError((error, c) => {
    console.error(
      redactText(
        JSON.stringify({
          method: c.req.method,
          path: c.req.path,
          message: error.message,
          stack: error.stack,
        }),
      ),
    );
    return c.json({ error: 'Internal server error' } satisfies ApiError, 500);
  });
  app.route('/api', healthRoutes(transport, options.authMode ?? 'none'));
  app.route('/api', eventRoutes(transport));
  app.route('/api', machineRoutes(machines));
  const relay: MiddlewareHandler = async (c) => {
    if (
      c.req.method !== 'GET' &&
      c.req.method !== 'POST' &&
      c.req.method !== 'HEAD'
    )
      return c.json({ error: 'Not found' } satisfies ApiError, 404);
    let path = c.req.path.slice(4) || '/';
    let machineId = 'local';
    if (path === '/m' || path.startsWith('/m/')) {
      const match = /^\/m\/([^/]+)(\/.*)?$/.exec(path);
      if (!match) return c.json({ error: 'Not found' } satisfies ApiError, 404);
      machineId = match[1]!;
      path = match[2] || '/';
    }
    const machine = machines.get(machineId);
    if (!machine) return c.json({ error: 'Not found' } satisfies ApiError, 404);
    if (machine.summary.state === 'offline' || !machine.transport)
      return c.json({ error: 'Machine offline', reason: 'offline' }, 503);
    const method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
    let body: Uint8Array | undefined;
    if (method === 'POST') {
      const result = await readLimitedBody(
        c.req.raw,
        limits.requestBodyMaxBytes,
      );
      if (result instanceof Response) return result;
      body = result;
    }
    const response = await machine.transport.request(
      {
        method,
        path,
        query: c.req.query(),
        ...(body ? { body } : {}),
      },
      c.req.raw.signal,
    );
    if (c.req.method === 'HEAD') {
      const iterator = response.body[Symbol.asyncIterator]();
      if (iterator.return) await iterator.return();
      else {
        for (;;) {
          const chunk = await iterator.next();
          if (chunk.done) break;
        }
      }
      return new Response(null, {
        status: response.status,
        headers: { 'Content-Type': response.contentType },
      });
    }
    return transportResponse(response);
  };
  app.all('/api', relay);
  app.all('/api/*', relay);
  if (options.webDist) {
    app.use('*', serveStatic({ root: options.webDist }));
    app.get('*', serveStatic({ path: `${options.webDist}/index.html` }));
  }
  app.notFound((c) => c.json({ error: 'Not found' } satisfies ApiError, 404));
  return app;
}

async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | Response> {
  const tooLarge = () =>
    Response.json({ error: 'Request body too large' }, { status: 413 });
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    await request.body?.cancel();
    return tooLarge();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function normalizeHostname(value: string): string {
  return (value === '::1' ? '[::1]' : value).toLowerCase();
}
function authorityHostname(value: string): string | null {
  // Host is an authority, not a URL: reject credentials, paths and delimiters.
  if (!/^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]+)?$/.test(value))
    return null;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

import { eventRoutes } from './routes/events.js';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { redactText } from '@c9view/core';
import type { ApiError } from '@c9view/api';
import {
  DataStore,
  createNode,
  createNodeApp,
  createNodeHello,
  InProcessTransport,
  type NodeTransport,
  type ServerConfig,
} from '@c9view/node';
import { transportResponse } from './relay.js';
import { healthRoutes } from './routes/health.js';

export function createApp(
  config: ServerConfig,
  options: {
    store?: DataStore;
    transport?: NodeTransport;
    webDist?: string;
    auth?: MiddlewareHandler;
    allowedHosts?: string[];
  } = {},
) {
  const app = new Hono();
  const runtime = options.transport
    ? undefined
    : options.store
      ? {
          store: options.store,
          events: options.store.events,
          hello: createNodeHello(),
        }
      : createNode(config);
  const transport =
    options.transport ??
    new InProcessTransport(
      runtime!,
      createNodeApp(runtime!).onError((error) => {
        // Let the hub log the browser-facing path and sanitize the response.
        throw error;
      }),
    );
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
  app.route('/api', healthRoutes(transport));
  app.route('/api', eventRoutes(transport));
  const relay: MiddlewareHandler = async (c) => {
    if (c.req.method !== 'GET' && c.req.method !== 'POST')
      return c.json({ error: 'Not found' } satisfies ApiError, 404);
    const response = await transport.request(
      {
        method: c.req.method,
        path: c.req.path.slice(4) || '/',
        query: c.req.query(),
        ...(c.req.method === 'POST'
          ? { body: new Uint8Array(await c.req.raw.arrayBuffer()) }
          : {}),
      },
      c.req.raw.signal,
    );
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

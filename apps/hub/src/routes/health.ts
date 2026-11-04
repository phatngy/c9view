import { VERSION } from '@c9view/core';
import type { AuthMode } from '../auth/index.js';
import { Hono } from 'hono';
import type { NodeTransport } from '@c9view/node';
import { transportResponse } from '../relay.js';

export function healthRoutes(
  transport: NodeTransport | null,
  auth: AuthMode = 'none',
) {
  const app = new Hono();
  app.get('/health', async (c) => {
    const hub = {
      ok: true,
      version: VERSION,
      auth,
      machines: transport ? 1 : 0,
    };
    if (!transport) return c.json(hub);
    const response = transportResponse(
      await transport.request(
        { method: 'GET', path: '/health', query: c.req.query() },
        c.req.raw.signal,
      ),
    );
    if (!response.ok) return response;
    const body = (await response.json()) as Record<string, unknown>;
    return c.json({
      ...hub,
      claudeDir: body.claudeDir,
      index: body.index,
      hooks: body.hooks,
    });
  });
  return app;
}

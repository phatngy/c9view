import { Hono } from 'hono';
import type { NodeTransport } from '@c9view/node';
import { transportResponse } from '../relay.js';

export function healthRoutes(transport: NodeTransport) {
  const app = new Hono();
  app.get('/health', async (c) => {
    const response = transportResponse(
      await transport.request(
        { method: 'GET', path: '/health', query: c.req.query() },
        c.req.raw.signal,
      ),
    );
    if (!response.ok) return response;
    const body = (await response.json()) as Record<string, unknown>;
    return c.json({ ok: true, ...body });
  });
  return app;
}

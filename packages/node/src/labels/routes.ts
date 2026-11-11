import { Hono } from 'hono';
import { z } from 'zod';
import type { ControlService } from '../control/service.js';
import { ControlError } from '../control/errors.js';
import { controlErrorResponse, readCommand } from '../control/http.js';

/** Mounted only with control on, so every label route is 404 with control off. */
export function labelRoutes(service: ControlService, bodyMaxBytes = 48 * 1024) {
  const app = new Hono();
  const body = z
    .object({ clientRequestId: z.uuid(), label: z.string().max(80) })
    .strict();
  app.onError((error, c) =>
    controlErrorResponse(error, (b, status) => c.json(b, status)),
  );
  app.get('/labels', (c) => c.json(service.labels()));
  app.post('/projects/:projectId/sessions/:sessionId/label', async (c) => {
    const { boot, value } = await readCommand(
      c.req.raw,
      bodyMaxBytes,
      c.req.header('x-c9view-boot-id'),
    );
    const parsed = body.safeParse(value);
    if (!parsed.success) throw new ControlError(400, 'Invalid control request');
    return c.json(
      await service.label(
        c.req.param('projectId'),
        c.req.param('sessionId'),
        parsed.data,
        boot,
      ),
      200,
    );
  });
  return app;
}

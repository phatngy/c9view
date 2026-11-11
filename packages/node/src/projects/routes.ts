import { Hono } from 'hono';
import { z } from 'zod';
import type { NewProjectBody } from '@c9view/api';
import type { ControlService } from '../control/service.js';
import { ControlError } from '../control/errors.js';
import { controlErrorResponse, readCommand } from '../control/http.js';

/** Mounted only with control on; every route is 404 without workspace roots. */
export function projectCreateRoutes(
  service: ControlService,
  textMaxChars = 20000,
  bodyMaxBytes = 48 * 1024,
) {
  const app = new Hono();
  const body = z
    .object({
      clientRequestId: z.uuid(),
      location: z.string().min(1).max(4096),
      gitUrl: z.string().min(1).max(2048).optional(),
      gitInit: z.boolean().optional(),
      text: z.string().min(1).max(textMaxChars),
      name: z.string().min(1).max(80).optional(),
      permissionMode: z.enum(['default', 'acceptEdits', 'plan']).optional(),
    })
    .strict();
  app.onError((error, c) =>
    controlErrorResponse(error, (b, status) => c.json(b, status)),
  );
  app.get('/workspace/roots', async (c) => {
    const roots = await service.workspaceRoots();
    if (roots.length === 0) throw new ControlError(404, 'Not found');
    return c.json({ roots });
  });
  app.get('/workspace/browse', async (c) =>
    c.json(
      await service.browse(c.req.query('path'), c.req.query('hidden') === '1'),
    ),
  );
  app.post('/projects', async (c) => {
    const { boot, value } = await readCommand(
      c.req.raw,
      bodyMaxBytes,
      c.req.header('x-c9view-boot-id'),
    );
    const parsed = body.safeParse(value);
    if (!parsed.success) throw new ControlError(400, 'Invalid control request');
    return c.json(
      await service.createProject(parsed.data as NewProjectBody, boot),
      202,
    );
  });
  return app;
}

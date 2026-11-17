import { Hono } from 'hono';
import { z } from 'zod';
import type { RemoteSendBody } from '@c9view/api';
import type { ControlService } from '../control/service.js';
import { ControlError } from '../control/errors.js';
import { readCommand } from '../control/http.js';
import { RemoteUnavailableError } from './errors.js';

const path = '/projects/:projectId/sessions/:sessionId/remote';

/**
 * GET and POST `…/remote`. Mounted by the control routes, so they exist only
 * with control on. Error bodies carry fixed strings only: never the socket
 * path, PID, version, token or message text.
 */
export function remoteRoutes(
  service: ControlService,
  textMaxChars = 20000,
  bodyMaxBytes = 48 * 1024,
) {
  const app = new Hono();
  const schema = z
    .object({
      clientRequestId: z.uuid(),
      text: z.string().min(1).max(textMaxChars),
    })
    .strict();
  app.onError((error, c) => {
    if (error instanceof RemoteUnavailableError)
      return c.json(
        {
          error: error.message,
          reason: error.reason,
          availability: error.availability,
        },
        error.status,
      );
    return error instanceof ControlError
      ? c.json(
          {
            error: error.message,
            ...(error.reason ? { reason: error.reason } : {}),
          },
          error.status,
        )
      : c.json({ error: 'Control operation failed' }, 500);
  });
  app.get(path, async (c) =>
    c.json(
      await service.remoteAvailability(
        c.req.param('projectId'),
        c.req.param('sessionId'),
      ),
    ),
  );
  app.post(path, async (c) => {
    const { boot, value } = await readCommand(
      c.req.raw,
      bodyMaxBytes,
      c.req.header('x-c9view-boot-id'),
    );
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ControlError(400, 'Invalid control request');
    return c.json(
      await service.remoteSend(
        c.req.param('projectId'),
        c.req.param('sessionId'),
        parsed.data as RemoteSendBody,
        boot,
      ),
      202,
    );
  });
  return app;
}

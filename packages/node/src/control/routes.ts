import { Hono } from 'hono';
import { z } from 'zod';
import type { ReplyBody, NewSessionBody, DecisionBody } from '@c9view/api';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ControlService } from './service.js';
import { ControlError } from './errors.js';
import { readCommand } from './http.js';
const command = { clientRequestId: z.uuid() };
const mode = z.enum(['default', 'acceptEdits', 'plan']);
export function controlRoutes(
  service: ControlService,
  textMaxChars = 20000,
  bodyMaxBytes = 48 * 1024,
) {
  const app = new Hono();
  const text = z.string().min(1).max(textMaxChars);
  const schemas = {
    reply: z
      .object({ ...command, text, fork: z.boolean().optional() })
      .strict(),
    start: z
      .object({
        ...command,
        text,
        name: z.string().min(1).max(80).optional(),
        permissionMode: mode.optional(),
      })
      .strict(),
    decision: z.union([
      z.object({ ...command, decision: z.literal('allow') }).strict(),
      z
        .object({
          ...command,
          decision: z.literal('deny'),
          message: z.string().max(2000).optional(),
        })
        .strict(),
      z
        .object({
          ...command,
          answers: z.record(
            z.string(),
            z.union([
              z.string().min(1).max(2000),
              z.array(z.string().min(1).max(2000)).min(1),
            ]),
          ),
        })
        .strict(),
    ]),
    action: z.object(command).strict(),
    mode: z.object({ ...command, mode }).strict(),
    trust: z
      .object({
        ...command,
        path: z.string().min(1),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  };
  app.onError((error, c) =>
    error instanceof ControlError
      ? c.json(
          {
            error: error.message,
            ...(error.reason ? { reason: error.reason } : {}),
            ...(error.trust ? { trust: error.trust } : {}),
          },
          error.status,
        )
      : c.json({ error: 'Control operation failed' }, 500),
  );
  app.get('/control/runs', (c) => c.json(service.snapshot()));
  app.get('/control/receipts/:clientRequestId', (c) => {
    const receipt = service.receipt(c.req.param('clientRequestId'));
    return receipt ? c.json(receipt) : c.json({ error: 'Not found' }, 404);
  });
  function post<T extends object>(
    path: string,
    schema: z.ZodType<T>,
    status: ContentfulStatusCode,
    action: (
      params: Record<string, string>,
      body: T,
      boot: string,
    ) => Promise<unknown>,
  ) {
    app.post(path, async (c) => {
      const { boot, value } = await readCommand(
        c.req.raw,
        bodyMaxBytes,
        c.req.header('x-c9view-boot-id'),
      );
      // All bodies reject unknown fields, including ambiguous decision shapes.
      if (
        path === '/control/requests/:requestId' &&
        value &&
        typeof value === 'object' &&
        'decision' in value &&
        'answers' in value
      )
        throw new ControlError(400, 'Provide exactly one decision');
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        throw new ControlError(400, 'Invalid control request');
      return c.json(await action(c.req.param(), parsed.data, boot), status);
    });
  }
  post(
    '/projects/:projectId/sessions/:sessionId/messages',
    schemas.reply,
    202,
    (p, b, boot) =>
      service.reply(p.projectId!, p.sessionId!, b as ReplyBody, boot),
  );
  post('/projects/:projectId/sessions', schemas.start, 202, (p, b, boot) =>
    service.start(p.projectId!, b as NewSessionBody, boot),
  );
  post('/control/requests/:requestId', schemas.decision, 200, (p, b, boot) =>
    service.decide(p.requestId!, b as DecisionBody, boot),
  );
  post('/control/runs/:runId/interrupt', schemas.action, 200, (p, b, boot) =>
    service.interrupt(p.runId!, b, boot),
  );
  post('/control/runs/:runId/stop', schemas.action, 200, (p, b, boot) =>
    service.stop(p.runId!, b, boot),
  );
  post('/control/runs/:runId/mode', schemas.mode, 200, (p, b, boot) =>
    service.setMode(p.runId!, b, boot),
  );
  post('/projects/trust', schemas.trust, 200, (_p, b, boot) =>
    service.trust(b, boot),
  );
  return app;
}

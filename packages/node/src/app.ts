import { Hono } from 'hono';
import { redactText } from '@c9view/core';
import type { ApiError } from '@c9view/api';
import { redactStrings } from './data/redaction.js';
import type { NodeRuntime } from './runtime.js';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';
import { overviewRoutes } from './routes/overview.js';
import { usageRoutes } from './routes/usage.js';
import { projectRoutes } from './routes/projects.js';
import { sessionRoutes } from './routes/sessions.js';
import { configRoutes } from './routes/config.js';
import { fileRoutes } from './routes/files.js';
import { changeRoutes } from './routes/changes.js';

export function createNodeApp(runtime: Pick<NodeRuntime, 'store'>) {
  const app = new Hono();
  const { store } = runtime;
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
  app.get(
    '/projects/:projectId/sessions/:sessionId/status/history',
    async (c) => {
      const found = await store.findSession(
        c.req.param('projectId'),
        c.req.param('sessionId'),
        false,
        true,
      );
      if (!found) return c.json({ error: 'Not found' } satisfies ApiError, 404);
      return c.json(redactStrings(store.hooks.history(found.session.id)));
    },
  );
  for (const routes of [
    healthRoutes,
    searchRoutes,
    overviewRoutes,
    usageRoutes,
    projectRoutes,
    sessionRoutes,
    configRoutes,
    fileRoutes,
    changeRoutes,
  ])
    app.route('/', routes(store));
  app.notFound((c) => c.json({ error: 'Not found' } satisfies ApiError, 404));
  return app;
}

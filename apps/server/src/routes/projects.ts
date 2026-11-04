import { redactStrings } from '../data/redaction.js';
import { Hono } from 'hono';
import type {
  ApiError,
  ProjectDetailResponse,
  ProjectsResponse,
} from '@c9view/api';
import { projectConfig } from '../data/config.js';
import type { DataStore } from '../data/store.js';
export function projectRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/projects', async (c) => {
    const response: ProjectsResponse = {
      projects: (await store.snapshot()).map((p) => p.project),
    };
    return c.json(redactStrings(response));
  });
  app.get('/projects/:projectId', async (c) => {
    const found = (await store.snapshot()).find(
      (p) => p.project.id === c.req.param('projectId'),
    );
    if (!found)
      return c.json({ error: 'Project not found' } satisfies ApiError, 404);
    const response: ProjectDetailResponse = {
      project: found.project,
      sessions: found.sessions,
      config: await projectConfig(
        store.config.claudeDir,
        found.project.path,
        found.discovered.dir,
      ),
    };
    return c.json(redactStrings(response));
  });
  return app;
}

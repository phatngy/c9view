import { Hono } from 'hono';
import type {
  SessionChangesResponse,
  SessionFileDiffResponse,
} from '@c9view/api';
import type { DataStore } from '../data/store.js';
import { fileProject, cachedSessionChanges } from '../data/file-project.js';
import { redactStrings } from '../data/redaction.js';

export function changeRoutes(store: DataStore) {
  const app = new Hono();
  for (const route of [
    '/projects/:projectId/sessions/:sessionId/changes',
    '/projects/:projectId/sessions/:sessionId/changes/:fileId',
  ]) {
    app.get(route, async (c) => {
      const project = await fileProject(store, c.req.param('projectId')!);
      if (!project) return c.json({ error: 'Project not found' }, 404);
      const found = await store.findSession(
        c.req.param('projectId')!,
        c.req.param('sessionId')!,
        true,
      );
      if (!found) return c.json({ error: 'Session not found' }, 404);
      const changes = await cachedSessionChanges(
        store,
        found,
        project.project.path,
      );
      const fileId = c.req.param('fileId');
      if (fileId !== undefined) {
        const response: SessionFileDiffResponse | undefined =
          await changes.sessionFileDiff(fileId);
        return response
          ? c.json(redactStrings(response))
          : c.json({ error: 'File change not found' }, 404);
      }
      const response: SessionChangesResponse = {
        files: changes.files,
        truncated: changes.truncated,
      };
      return c.json(redactStrings(response));
    });
  }
  return app;
}

import { Hono } from 'hono';
import { createFileAccess, createGit, parseGitDiff } from '@c9view/core';
import type {
  ApiError,
  FileContentResponse,
  FileListResponse,
  GitDiffResponse,
  GitStatusResponse,
} from '@c9view/api';
import type { DataStore } from '../data/store.js';
import { fileProject } from '../data/file-project.js';
import { redactStrings } from '../data/redaction.js';

export function fileRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/projects/:projectId/files', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    const path = c.req.query('path') ?? '';
    try {
      const response: FileListResponse = {
        path,
        entries: await createFileAccess({ root: found.project.path }).listDir(
          path,
        ),
      };
      return c.json(redactStrings(response));
    } catch {
      return c.json({ error: 'Path unavailable or forbidden' }, 400);
    }
  });
  app.get('/projects/:projectId/file', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    try {
      const response: FileContentResponse = await createFileAccess({
        root: found.project.path,
      }).readFile(c.req.query('path') ?? '');
      return c.json(redactStrings(response));
    } catch {
      return c.json({ error: 'Path unavailable or forbidden' }, 400);
    }
  });
  app.get('/projects/:projectId/git/status', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    try {
      const git = createGit(found.project.path);
      const response: GitStatusResponse = (await git.isRepo())
        ? { isRepo: true, ...(await git.status()) }
        : { isRepo: false };
      return c.json(redactStrings(response));
    } catch (error) {
      console.error('Git status failed', error);
      const response: ApiError = { error: 'Git read failed' };
      return c.json(response, gitTimeout(error) ? 504 : 400);
    }
  });
  app.get('/projects/:projectId/git/diff', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    const git = createGit(found.project.path);
    try {
      const isRepo = await git.isRepo();
      const response: GitDiffResponse = {
        isRepo,
        files: isRepo ? parseGitDiff(await git.diff(c.req.query('path'))) : [],
      };
      return c.json(redactStrings(response));
    } catch (error) {
      console.error('Git diff failed', error);
      const response: ApiError = { error: 'Git read failed' };
      return c.json(response, gitTimeout(error) ? 504 : 400);
    }
  });
  return app;
}

function gitTimeout(error: unknown): boolean {
  return (
    error instanceof Error && 'timedOut' in error && error.timedOut === true
  );
}

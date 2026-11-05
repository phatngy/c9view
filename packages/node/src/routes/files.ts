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
import { DEFAULT_NODE_LIMITS, type NodeLimits } from '../limits.js';
import {
  budgetOffsetPage,
  encodedBytes,
  fitHunks,
  readOffsetCursor,
  serializePage,
} from '../budget.js';

type DiffFile = GitDiffResponse['files'][number];

export function fileRoutes(
  store: DataStore,
  limits: Pick<
    NodeLimits,
    'pageBudgetBytes' | 'fileBudgetBytes'
  > = DEFAULT_NODE_LIMITS,
) {
  const app = new Hono();
  const budget = limits.pageBudgetBytes;
  const badCursor = { error: 'Invalid cursor' } satisfies ApiError;
  app.get('/projects/:projectId/files', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    const path = c.req.query('path') ?? '';
    const offset = readOffsetCursor(c.req.query('cursor'));
    if (offset === null) return c.json(badCursor, 400);
    try {
      const entries = redactStrings(
        await createFileAccess({ root: found.project.path }).listDir(path),
      );
      const envelope = redactStrings({ path, entries: [], nextCursor: null });
      const page = budgetOffsetPage(
        entries,
        offset,
        budget,
        encodedBytes(envelope),
      );
      const response: FileListResponse = {
        ...envelope,
        entries: page.items,
        nextCursor: page.nextCursor,
      };
      const text = serializePage('files', response, budget);
      return c.body(text, 200, { 'content-type': 'application/json' });
    } catch {
      return c.json({ error: 'Path unavailable or forbidden' }, 400);
    }
  });
  app.get('/projects/:projectId/file', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    try {
      const response: FileContentResponse = redactStrings(
        await createFileAccess({
          root: found.project.path,
        }).readFile(c.req.query('path') ?? ''),
      );
      if (
        response.tooLarge ||
        encodedBytes(response) > limits.fileBudgetBytes
      ) {
        delete response.content;
        response.tooLarge = true;
        response.notice = 'too-large';
      }
      return c.json(response);
    } catch {
      return c.json({ error: 'Path unavailable or forbidden' }, 400);
    }
  });
  app.get('/projects/:projectId/git/status', async (c) => {
    const found = await fileProject(store, c.req.param('projectId'));
    if (!found) return c.json({ error: 'Project not found' }, 404);
    const offset = readOffsetCursor(c.req.query('cursor'));
    if (offset === null) return c.json(badCursor, 400);
    try {
      const git = createGit(found.project.path);
      if (!(await git.isRepo())) {
        const response = { isRepo: false } satisfies GitStatusResponse;
        const text = serializePage('git/status', response, budget);
        return c.body(text, 200, { 'content-type': 'application/json' });
      }
      const status = redactStrings(await git.status());
      const envelope = { isRepo: true as const, ...status, files: [] };
      const page = budgetOffsetPage(
        status.files,
        offset,
        budget,
        encodedBytes(envelope),
      );
      const response: GitStatusResponse = {
        ...envelope,
        files: page.items,
        nextCursor: page.nextCursor,
      };
      const text = serializePage('git/status', response, budget);
      return c.body(text, 200, { 'content-type': 'application/json' });
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
    const offset = readOffsetCursor(c.req.query('cursor'));
    if (offset === null) return c.json(badCursor, 400);
    try {
      const isRepo = await git.isRepo();
      const files: DiffFile[] = isRepo
        ? redactStrings(parseGitDiff(await git.diff(c.req.query('path'))))
        : [];
      const page = budgetOffsetPage(
        files,
        offset,
        budget,
        encodedBytes({ isRepo, files: [], nextCursor: null }),
        shrinkDiffFile,
      );
      const response: GitDiffResponse = {
        isRepo,
        files: page.items,
        nextCursor: page.nextCursor,
      };
      const text = serializePage('git/diff', response, budget);
      return c.body(text, 200, { 'content-type': 'application/json' });
    } catch (error) {
      console.error('Git diff failed', error);
      const response: ApiError = { error: 'Git read failed' };
      return c.json(response, gitTimeout(error) ? 504 : 400);
    }
  });
  return app;
}

/** One file's diff larger than a page keeps the hunks and lines that fit. */
export function shrinkDiffFile(file: DiffFile, roomBytes: number): DiffFile {
  const shell = { ...file, hunks: [], truncated: true };
  const { hunks } = fitHunks(
    file.hunks,
    Math.max(0, roomBytes - encodedBytes(shell) + 2),
  );
  return { ...shell, hunks };
}

function gitTimeout(error: unknown): boolean {
  return (
    error instanceof Error && 'timedOut' in error && error.timedOut === true
  );
}

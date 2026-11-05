import { Hono } from 'hono';
import type {
  SessionChangesResponse,
  SessionFileDiffResponse,
} from '@c9view/api';
import type { DataStore } from '../data/store.js';
import { fileProject, cachedSessionChanges } from '../data/file-project.js';
import { redactStrings } from '../data/redaction.js';
import { DEFAULT_NODE_LIMITS, type NodeLimits } from '../limits.js';
import {
  budgetItems,
  budgetOffsetPage,
  encodedBytes,
  fitHunks,
  readOffsetCursor,
} from '../budget.js';

export function changeRoutes(
  store: DataStore,
  limits: Pick<NodeLimits, 'pageBudgetBytes'> = DEFAULT_NODE_LIMITS,
) {
  const app = new Hono();
  const budget = limits.pageBudgetBytes;
  for (const route of [
    '/projects/:projectId/sessions/:sessionId/changes',
    '/projects/:projectId/sessions/:sessionId/changes/:fileId',
  ]) {
    app.get(route, async (c) => {
      const offset = readOffsetCursor(c.req.query('cursor'));
      if (offset === null) return c.json({ error: 'Invalid cursor' }, 400);
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
          ? c.json(fitFileDiff(redactStrings(response), budget))
          : c.json({ error: 'File change not found' }, 404);
      }
      const files = redactStrings(changes.files);
      const envelope = { files: [], truncated: true, nextCursor: null };
      const page = budgetOffsetPage(
        files,
        offset,
        budget,
        encodedBytes(envelope),
      );
      const response: SessionChangesResponse = {
        files: page.items,
        truncated: changes.truncated,
        nextCursor: page.nextCursor,
      };
      return c.json(response);
    });
  }
  return app;
}

/**
 * A file diff over the page budget keeps the net hunks that fit in half the
 * budget and the steps that fit in the rest, and is marked `truncated`.
 */
export function fitFileDiff(
  response: SessionFileDiffResponse,
  budget: number,
): SessionFileDiffResponse {
  if (encodedBytes(response) <= budget) return response;
  const shell = { ...response, hunks: [], steps: [], truncated: true };
  const room = budget - encodedBytes(shell) - 64;
  const { hunks } = fitHunks(response.hunks, Math.floor(room / 2));
  const steps = budgetItems(response.steps, {
    envelopeBytes: encodedBytes({ ...shell, hunks }) + 64,
    budgetBytes: budget,
    shrink: (step, stepRoom) => ({
      ...step,
      hunks: fitHunks(
        step.hunks,
        stepRoom - encodedBytes({ ...step, hunks: [] }) + 2,
      ).hunks,
    }),
  });
  return { ...shell, hunks, steps: steps.items };
}

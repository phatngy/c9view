import { redactStrings } from '../data/redaction.js';
import { indexedMessages } from '../data/indexed.js';
import { Hono } from 'hono';
import { listSubagents } from '@c9view/core';
import type { ApiError, SessionDetailResponse } from '@c9view/api';
import type { DataStore } from '../data/store.js';
import type { SessionPollResponse } from '@c9view/api';
function pageNumber(
  raw: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? Math.min(value, max) : fallback;
}
export function sessionRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/projects/:projectId/sessions/:sessionId', async (c) => {
    const found = await store.findSession(
      c.req.param('projectId'),
      c.req.param('sessionId'),
      true,
    );
    if (!found)
      return c.json({ error: 'Session not found' } satisfies ApiError, 404);
    const { cached, session } = found;

    const rawCursor = c.req.query('cursor');
    const requestedCursor =
      c.req.query('from') === 'end' ? 'end' : pageNumber(rawCursor, 0);
    const limit = Math.max(1, pageNumber(c.req.query('limit'), 200, 1000));
    const indexed = store.readyIndex
      ? await indexedMessages(
          store.readyIndex,
          session.id,
          requestedCursor,
          limit,
        )
      : null;
    const all = indexed
      ? []
      : (cached.messages ??= (await store.cache.mapped(found.path)).messages);
    const cursor =
      indexed?.cursor ??
      (requestedCursor === 'end'
        ? Math.max(0, all.length - limit)
        : Math.min(requestedCursor, all.length));
    const response: SessionDetailResponse = {
      session,
      cwd: cached.summary.cwd ?? null,
      version: cached.summary.version ?? null,
      permissionModes: cached.summary.permissionModes,
      toolUseCounts: cached.summary.toolUseCounts,
      errorCount: cached.summary.errorCount,
      byModel: await store.sessionModels(found.path, session.id),
      subagents: (await listSubagents(found.dir, session.id)).map((a) => ({
        agentId: a.agentId,
        description: a.description ?? null,
        parentToolUseId: a.parentToolUseId ?? null,
      })),
      messages: indexed?.messages ?? all.slice(cursor, cursor + limit),
      cursor,
      prevCursor: indexed
        ? indexed.prevCursor
        : cursor > 0
          ? Math.max(0, cursor - limit)
          : null,
      nextCursor: indexed
        ? indexed.nextCursor
        : cursor + limit < all.length
          ? cursor + limit
          : null,
      totalMessages: indexed?.totalMessages ?? all.length,
    };
    return c.json(redactStrings(response));
  });
  app.get('/projects/:projectId/sessions/:sessionId/status', async (c) => {
    const found = await store.findSession(
      c.req.param('projectId'),
      c.req.param('sessionId'),
      false,
      true,
    );
    if (!found)
      return c.json({ error: 'Session not found' } satisfies ApiError, 404);
    const response: SessionPollResponse = {
      status: found.session.status,
      totalMessages: found.cached.totalMessages,
      lastAt: found.session.lastAt,
    };
    return c.json(redactStrings(response));
  });
  return app;
}

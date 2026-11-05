import { redactStrings } from '../data/redaction.js';
import { indexedMessages } from '../data/indexed.js';
import { Hono } from 'hono';
import { listSubagents } from '@c9view/core';
import type { ApiError, SessionDetailResponse } from '@c9view/api';
import type { DataStore } from '../data/store.js';
import type { SessionPollResponse } from '@c9view/api';
import { DEFAULT_NODE_LIMITS, type NodeLimits } from '../limits.js';
import { budgetItems, encodedBytes, warnPageBudget } from '../budget.js';
import { shrinkMessage } from './session-budget.js';
// Cursor fields may grow by a few digits after the envelope is measured.
const CURSOR_SLACK = 64;
function pageNumber(
  raw: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? Math.min(value, max) : fallback;
}
export function sessionRoutes(
  store: DataStore,
  limits: Pick<NodeLimits, 'pageBudgetBytes'> = DEFAULT_NODE_LIMITS,
) {
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
    const fromEnd = requestedCursor === 'end' || c.req.query('fill') === 'end';
    const before = fromEnd
      ? pageNumber(c.req.query('before'), Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const indexed = store.readyIndex
      ? await indexedMessages(
          store.readyIndex,
          session.id,
          requestedCursor,
          limit,
          before,
        )
      : null;
    const all = indexed
      ? []
      : (cached.messages ??= (await store.cache.mapped(found.path)).messages);
    const cursor =
      indexed?.cursor ??
      (requestedCursor === 'end'
        ? Math.max(0, Math.min(all.length, before) - limit)
        : Math.min(requestedCursor, all.length, before));
    const total = indexed?.totalMessages ?? all.length;
    const windowEnd = indexed?.end ?? Math.min(cursor + limit, total, before);
    const window = indexed?.messages ?? all.slice(cursor, windowEnd);
    const ordinals = indexed?.ordinals ?? window.map((_, i) => cursor + i);
    const envelope: SessionDetailResponse = redactStrings({
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
      messages: [],
      cursor,
      prevCursor: null,
      nextCursor: null,
      totalMessages: total,
      truncated: true,
    });
    const page = budgetItems(window, {
      envelopeBytes: encodedBytes(envelope) + CURSOR_SLACK,
      budgetBytes: limits.pageBudgetBytes,
      fromEnd,
      shrink: shrinkMessage,
    });
    // A page cut from the end starts later than its window; one cut from the
    // start ends earlier. Either way the cursors stay contiguous.
    const start =
      fromEnd && page.more ? ordinals[window.length - page.count]! : cursor;
    const end = !fromEnd && page.more ? ordinals[page.count]! : windowEnd;
    const response: SessionDetailResponse = {
      ...envelope,
      messages: page.items,
      cursor: start,
      prevCursor: start > 0 ? Math.max(0, start - limit) : null,
      nextCursor: end < total ? end : null,
      totalMessages: total,
    };
    if (page.more || page.truncated) response.truncated = true;
    else delete response.truncated;
    const final = redactStrings(response);
    const text = warnPageBudget('sessions', final, limits.pageBudgetBytes);
    return c.body(text, 200, { 'content-type': 'application/json' });
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

import { redactStrings } from '../data/redaction.js';
import { Hono } from 'hono';
import { readStatsCache } from '@c9view/core';
import type { OverviewResponse } from '@c9view/api';
import { columns, sumTokens, type DataStore } from '../data/store.js';
export function overviewRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/overview', async (c) => {
    const [snapshot, stats] = await Promise.all([
      store.snapshot(),
      readStatsCache(store.config.claudeDir),
    ]);
    const counts = columns();
    for (const { sessions } of snapshot)
      for (const s of sessions) counts[s.status.column]++;
    const response: OverviewResponse = {
      projectCount: snapshot.length,
      sessionCount: snapshot.reduce((n, p) => n + p.sessions.length, 0),
      liveSessionCount:
        counts.in_progress + counts.need_input + counts.in_review,
      columns: counts,
      tokens: sumTokens(snapshot.map((p) => p.project.tokens)),
      costUsd: snapshot.reduce((n, p) => n + p.project.costUsd, 0),
      daily: stats
        ? stats.dailyActivity.map((d) => ({
            date: d.date ?? '',
            messages: d.messageCount ?? 0,
            sessions: d.sessionCount ?? 0,
            toolCalls: d.toolCallCount ?? 0,
          }))
        : null,
      byModel: await store.byModel(
        snapshot.flatMap((p) => p.discovered.sessionFiles.map((f) => f.path)),
      ),
    };
    return c.json(redactStrings(response));
  });
  return app;
}

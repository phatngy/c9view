import { basename } from 'node:path';
import type { IndexDatabase } from '@c9view/core';
import type { TokenTotals, UsageResponse, UsageTotal } from '@c9view/api';

export const emptyTotal = (): UsageTotal => ({
  costUsd: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 },
});
export function addTotal(target: UsageTotal, value: UsageTotal) {
  target.costUsd += value.costUsd;
  for (const key of Object.keys(target.tokens) as (keyof TokenTotals)[])
    target.tokens[key] += value.tokens[key];
}
export function dateInZone(value: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return ['year', 'month', 'day']
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join('-');
}
export function usageData(
  db: IndexDatabase,
  from: string,
  to: string,
  tz: string,
  projectId?: string,
): UsageResponse {
  const days: UsageResponse['days'] = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += 86400000)
    days.push({
      date: new Date(time).toISOString().slice(0, 10),
      ...emptyTotal(),
      byModel: [],
    });
  const byDate = new Map(days.map((day) => [day.date, day]));
  const models = new Map<string, UsageTotal>();
  const projects = new Map<string, UsageResponse['byProject'][number]>();
  const sessions = new Map<string, UsageTotal>();
  const rows = db.sqlite
    .prepare(
      `WITH ranked AS (
    SELECT m.sessionId,m.timestamp,m.model,m.usage,m.costUsd, row_number() OVER (PARTITION BY m.sessionId, coalesce(m.messageId,m.uuid) ORDER BY (m.usage IS NOT NULL) DESC, m.byteOffset DESC) AS rank,
    min(m.byteOffset) OVER (PARTITION BY m.sessionId, coalesce(m.messageId,m.uuid)) AS firstOffset
    FROM messages m WHERE m.type='assistant'
  ) SELECT r.*, coalesce(p.projectId,s.projectId) AS projectId, pr.path AS projectPath
    FROM ranked r JOIN sessions s ON s.id=r.sessionId
    LEFT JOIN sessions p ON p.id=s.parentSessionId AND p.isSubagent=0
    JOIN projects pr ON pr.id=coalesce(p.projectId,s.projectId)
    WHERE rank=1 AND r.usage IS NOT NULL AND (s.isSubagent=0 OR p.id IS NOT NULL)
    AND (? IS NULL OR coalesce(p.projectId,s.projectId)=?) ORDER BY s.id,firstOffset`,
    )
    .all(projectId ?? null, projectId ?? null) as {
    sessionId: string;
    timestamp: string | null;
    model: string | null;
    usage: string;
    costUsd: number;
    projectId: string;
    projectPath: string;
  }[];
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const row of rows) {
    if (!row.timestamp || !Number.isFinite(Date.parse(row.timestamp))) continue;
    const parts = formatter.formatToParts(new Date(row.timestamp));
    const date = ['year', 'month', 'day']
      .map((key) => parts.find((p) => p.type === key)!.value)
      .join('-');
    const day = byDate.get(date);
    if (!day) continue;
    const value = {
      costUsd: row.costUsd,
      tokens: JSON.parse(row.usage) as TokenTotals,
    };
    const model = row.model ?? 'Unknown';
    const dailyModel = day.byModel.find((m) => m.model === model) ?? {
      model,
      ...emptyTotal(),
    };
    if (!day.byModel.includes(dailyModel)) day.byModel.push(dailyModel);
    addTotal(dailyModel, value);
    addTotal(day, value);
    const m = models.get(model) ?? emptyTotal();
    addTotal(m, value);
    models.set(model, m);
    projects.set(
      row.projectId,
      projects.get(row.projectId) ?? {
        projectId: row.projectId,
        name: basename(row.projectPath),
        ...emptyTotal(),
      },
    );
    const session = sessions.get(row.sessionId) ?? emptyTotal();
    addTotal(session, value);
    sessions.set(row.sessionId, session);
  }
  // Match the cards' summation hierarchy, including floating-point addition order.
  const children = new Map<string, UsageTotal>();
  for (const row of db.sqlite
    .prepare('SELECT id,parentSessionId FROM sessions WHERE isSubagent=1')
    .all() as { id: string; parentSessionId: string }[]) {
    const child = children.get(row.parentSessionId) ?? emptyTotal();
    addTotal(child, sessions.get(row.id) ?? emptyTotal());
    children.set(row.parentSessionId, child);
  }
  for (const row of db.sqlite
    .prepare(
      'SELECT id,projectId FROM sessions WHERE isSubagent=0 ORDER BY projectId,id',
    )
    .all() as { id: string; projectId: string }[]) {
    const project = projects.get(row.projectId);
    if (!project) continue;
    const value = emptyTotal();
    addTotal(value, sessions.get(row.id) ?? emptyTotal());
    addTotal(value, children.get(row.id) ?? emptyTotal());
    addTotal(project, value);
  }
  const totals = emptyTotal();
  for (const project of [...projects.values()].sort((a, b) =>
    a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0,
  ))
    addTotal(totals, project);
  return {
    tz,
    from,
    to,
    days,
    byProject: [...projects.values()].sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...models]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, value]) => ({ model, ...value })),
    totals,
    cacheHit: days.map(({ date, tokens }) => {
      const denominator =
        tokens.cacheRead + tokens.input + tokens.cacheCreation;
      return {
        date,
        ratio: denominator ? tokens.cacheRead / denominator : null,
      };
    }),
  };
}

import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type {
  KanbanColumn,
  NodeSnapshot,
  OverviewResponse,
  ProjectSummary,
  ProjectsResponse,
  TokenTotals,
  UsageResponse,
} from '@c9view/api';
import type { HubMachine, Machines } from './machines.js';

export const DEFAULT_MERGE_TIMEOUT_MS = 5000;

/** C9VIEW_MERGE_TIMEOUT_MS: a positive safe integer, like the node limits. */
export function loadMergeTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.C9VIEW_MERGE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_MERGE_TIMEOUT_MS;
  const parsed = z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
    .safeParse(raw);
  if (!parsed.success)
    throw new Error('C9VIEW_MERGE_TIMEOUT_MS must be a positive safe integer');
  return parsed.data;
}

const number = z.number();
const tokenSchema = z.looseObject({
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number,
  thinking: number,
});
const columnsSchema = z.looseObject({
  in_progress: number,
  need_input: number,
  in_review: number,
  inactive: number,
});
const modelSchema = z.looseObject({
  model: z.string(),
  tokens: tokenSchema,
  costUsd: number,
});
const overviewSchema = z.looseObject({
  projectCount: number,
  sessionCount: number,
  liveSessionCount: number,
  columns: columnsSchema,
  tokens: tokenSchema,
  costUsd: number,
  daily: z
    .array(
      z.looseObject({
        date: z.string(),
        messages: number,
        sessions: number,
        toolCalls: number,
      }),
    )
    .nullable(),
  byModel: z.array(modelSchema),
});
const projectsSchema = z.looseObject({
  projects: z.array(z.looseObject({ id: z.string() })),
});
const usageTotal = { costUsd: number, tokens: tokenSchema };
const usageSchema = z.looseObject({
  tz: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.array(
    z.looseObject({
      date: z.string(),
      ...usageTotal,
      byModel: z.array(z.looseObject({ model: z.string(), ...usageTotal })),
    }),
  ),
  byProject: z.array(
    z.looseObject({ projectId: z.string(), name: z.string(), ...usageTotal }),
  ),
  byModel: z.array(z.looseObject({ model: z.string(), ...usageTotal })),
  totals: z.looseObject(usageTotal),
});

type Fetched =
  | { machineId: string; ok: true; data: unknown }
  | { machineId: string; ok: false };

const decoder = new TextDecoder();

/** One live read, capped by the merge timeout. Any failure leaves the machine out. */
async function readLive(
  machine: HubMachine,
  path: string,
  query: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Fetched> {
  const machineId = machine.summary.machineId;
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Merge timeout'));
      controller.abort();
    }, timeoutMs);
  });
  const work = (async (): Promise<unknown> => {
    const response = await machine.transport!.request(
      { method: 'GET', path, query },
      controller.signal,
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) chunks.push(chunk);
    if (response.status !== 200) throw new Error('Node error');
    return JSON.parse(decoder.decode(Buffer.concat(chunks)));
  })();
  work.catch(() => {});
  try {
    return { machineId, ok: true, data: await Promise.race([work, deadline]) };
  } catch {
    return { machineId, ok: false };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export function sumTokens(list: TokenTotals[]): TokenTotals {
  const total: TokenTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    thinking: 0,
  };
  for (const t of list) {
    total.input += t.input;
    total.output += t.output;
    total.cacheRead += t.cacheRead;
    total.cacheCreation += t.cacheCreation;
    total.thinking += t.thinking;
  }
  return total;
}

function emptyColumns(): Record<KanbanColumn, number> {
  return { in_progress: 0, need_input: 0, in_review: 0, inactive: 0 };
}

function mergeModels<
  T extends { model: string; tokens: TokenTotals; costUsd: number },
>(lists: T[][]): { model: string; tokens: TokenTotals; costUsd: number }[] {
  const byModel = new Map<string, TokenTotals[]>();
  const costs = new Map<string, number>();
  for (const item of lists.flat()) {
    byModel.set(item.model, [...(byModel.get(item.model) ?? []), item.tokens]);
    costs.set(item.model, (costs.get(item.model) ?? 0) + item.costUsd);
  }
  return [...byModel]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, tokens]) => ({
      model,
      tokens: sumTokens(tokens),
      costUsd: costs.get(model) ?? 0,
    }));
}

/** An offline machine's overview totals, from its last snapshot only. */
function overviewFromSnapshot(snapshot: NodeSnapshot): OverviewResponse {
  const columns = emptyColumns();
  for (const session of snapshot.sessions) columns[session.status.column]++;
  return {
    projectCount: snapshot.projects.length,
    sessionCount: snapshot.sessions.length,
    liveSessionCount:
      columns.in_progress + columns.need_input + columns.in_review,
    columns,
    tokens: sumTokens(snapshot.projects.map((p) => p.tokens)),
    costUsd: snapshot.projects.reduce((n, p) => n + p.costUsd, 0),
    daily: null,
    byModel: [],
  };
}

export function mergeOverviews(items: OverviewResponse[]): OverviewResponse {
  const columns = emptyColumns();
  for (const item of items)
    for (const column of Object.keys(columns) as KanbanColumn[])
      columns[column] += item.columns[column];
  let anyDaily = false;
  const daily = new Map<
    string,
    { date: string; messages: number; sessions: number; toolCalls: number }
  >();
  for (const item of items) {
    if (!item.daily) continue;
    anyDaily = true;
    for (const d of item.daily) {
      const row = daily.get(d.date) ?? {
        date: d.date,
        messages: 0,
        sessions: 0,
        toolCalls: 0,
      };
      row.messages += d.messages;
      row.sessions += d.sessions;
      row.toolCalls += d.toolCalls;
      daily.set(d.date, row);
    }
  }
  return {
    projectCount: items.reduce((n, i) => n + i.projectCount, 0),
    sessionCount: items.reduce((n, i) => n + i.sessionCount, 0),
    liveSessionCount: items.reduce((n, i) => n + i.liveSessionCount, 0),
    columns,
    tokens: sumTokens(items.map((i) => i.tokens)),
    costUsd: items.reduce((n, i) => n + i.costUsd, 0),
    daily: anyDaily
      ? [...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
      : null,
    byModel: mergeModels(items.map((i) => i.byModel)),
  };
}

type UsageParsed = z.infer<typeof usageSchema>;

export function mergeUsage(items: UsageParsed[]): UsageResponse {
  const first = items[0]!;
  const dayMap = new Map<
    string,
    { tokens: TokenTotals[]; costUsd: number; models: UsageParsed['byModel'][] }
  >();
  for (const item of items)
    for (const day of item.days) {
      const row = dayMap.get(day.date) ?? {
        tokens: [],
        costUsd: 0,
        models: [],
      };
      row.tokens.push(day.tokens);
      row.costUsd += day.costUsd;
      row.models.push(day.byModel);
      dayMap.set(day.date, row);
    }
  const days = [...dayMap]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      costUsd: row.costUsd,
      tokens: sumTokens(row.tokens),
      byModel: mergeModels(row.models).map((m) => ({
        model: m.model,
        costUsd: m.costUsd,
        tokens: m.tokens,
      })),
    }));
  return {
    tz: first.tz,
    from: first.from,
    to: first.to,
    days,
    byProject: [],
    byModel: mergeModels(items.map((i) => i.byModel)).map((m) => ({
      model: m.model,
      costUsd: m.costUsd,
      tokens: m.tokens,
    })),
    totals: {
      costUsd: items.reduce((n, i) => n + i.totals.costUsd, 0),
      tokens: sumTokens(items.map((i) => i.totals.tokens)),
    },
    cacheHit: days.map(({ date, tokens }) => {
      const denominator =
        tokens.input + tokens.cacheRead + tokens.cacheCreation;
      return {
        date,
        ratio: denominator ? tokens.cacheRead / denominator : null,
      };
    }),
  };
}

/**
 * Merged `/api/overview`, `/api/projects` and `/api/usage` (R17, R19), as a
 * middleware mounted before the `local` alias. Online machines are read live
 * in parallel, each capped at `timeoutMs`; one that fails or is too slow is
 * named in `partial`. Offline machines add their last snapshot (overview and
 * projects) and are named in `offline`. Any other path, and a hub whose only
 * machine is `local`, falls through, so a single-machine hub behaves as before.
 */
export function mergedEndpoints(
  machines: Machines,
  timeoutMs: number,
): MiddlewareHandler {
  async function gather(
    path: string,
    query: Record<string, string>,
    signal: AbortSignal,
  ) {
    const live: Promise<Fetched>[] = [];
    const offline: HubMachine[] = [];
    for (const machine of machines.entriesList()) {
      if (machine.summary.state === 'offline' || !machine.transport)
        offline.push(machine);
      else live.push(readLive(machine, path, query, timeoutMs, signal));
    }
    return { fetched: await Promise.all(live), offline };
  }

  return async (c, next) => {
    const all = machines.entriesList();
    const path = c.req.path;
    if (
      c.req.method !== 'GET' ||
      (path !== '/api/overview' &&
        path !== '/api/projects' &&
        path !== '/api/usage') ||
      all.length === 0 ||
      (all.length === 1 && all[0]!.summary.machineId === 'local')
    )
      return next();
    const { fetched, offline } = await gather(
      path.slice(4),
      c.req.query(),
      c.req.raw.signal,
    );
    const partial: string[] = [];
    const offlineIds = offline.map((m) => m.summary.machineId);

    if (path === '/api/overview') {
      const items: OverviewResponse[] = [];
      for (const f of fetched) {
        const parsed = f.ok ? overviewSchema.safeParse(f.data) : null;
        if (parsed?.success) items.push(parsed.data as OverviewResponse);
        else partial.push(f.machineId);
      }
      for (const m of offline)
        if (m.snapshot) items.push(overviewFromSnapshot(m.snapshot));
      return c.json({
        ...mergeOverviews(items),
        partial,
        offline: offlineIds,
      } satisfies OverviewResponse);
    }

    if (path === '/api/projects') {
      const projects: ProjectSummary[] = [];
      for (const f of fetched) {
        const parsed = f.ok ? projectsSchema.safeParse(f.data) : null;
        if (parsed?.success)
          for (const p of parsed.data.projects)
            projects.push({
              ...(p as unknown as ProjectSummary),
              machineId: f.machineId,
            });
        else partial.push(f.machineId);
      }
      for (const m of offline)
        for (const p of m.snapshot?.projects ?? [])
          projects.push({
            ...p,
            machineId: m.summary.machineId,
            offline: true,
          });
      return c.json({ projects, partial } satisfies ProjectsResponse);
    }

    const items: UsageParsed[] = [];
    const byProject: UsageResponse['byProject'] = [];
    for (const f of fetched) {
      const parsed = f.ok ? usageSchema.safeParse(f.data) : null;
      if (parsed?.success) {
        items.push(parsed.data);
        for (const p of parsed.data.byProject)
          byProject.push({
            ...(p as UsageResponse['byProject'][number]),
            machineId: f.machineId,
          });
      } else partial.push(f.machineId);
    }
    // Offline machines have no usage history in a snapshot: named, not counted.
    if (!items.length)
      return c.json(
        { error: 'No machine answered', partial, offline: offlineIds },
        503,
      );
    const merged = mergeUsage(items);
    merged.byProject = byProject.sort((a, b) => b.costUsd - a.costUsd);
    return c.json({ ...merged, partial, offline: offlineIds });
  };
}

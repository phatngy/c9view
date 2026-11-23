import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeHello, type NodeTransport } from '@c9view/node';
import type {
  NodeSnapshot,
  OverviewResponse,
  ProjectSummary,
  ProjectsResponse,
  UsageResponse,
} from '@c9view/api';
import { Hono } from 'hono';
import { loadMergeTimeoutMs, mergedEndpoints } from './aggregate.js';
import { Machines, type HubMachine } from './machines.js';

const zero = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  thinking: 0,
};
const columns = { in_progress: 0, need_input: 0, in_review: 0, inactive: 1 };

function project(id: string, costUsd = 1): ProjectSummary {
  return {
    id,
    name: id,
    path: `/synthetic/${id}`,
    pathExists: true,
    sessionCount: 1,
    lastActivityAt: null,
    columns,
    tokens: { ...zero, input: 10, cacheRead: 10 },
    costUsd,
  };
}
const overview = (costUsd: number): OverviewResponse => ({
  projectCount: 1,
  sessionCount: 2,
  liveSessionCount: 0,
  columns: { ...columns, inactive: 2 },
  tokens: { ...zero, input: 10 },
  costUsd,
  daily: [{ date: '2026-10-25', messages: 1, sessions: 1, toolCalls: 1 }],
  byModel: [{ model: 'm', tokens: { ...zero, input: 10 }, costUsd }],
});
const usage = (costUsd: number, projectId: string): UsageResponse => ({
  tz: 'UTC',
  from: '2026-10-25',
  to: '2026-10-25',
  days: [
    {
      date: '2026-10-25',
      costUsd,
      tokens: { ...zero, input: 10, cacheRead: 30 },
      byModel: [],
    },
  ],
  byProject: [
    { projectId, name: projectId, costUsd, tokens: { ...zero, input: 10 } },
  ],
  byModel: [],
  totals: { costUsd, tokens: { ...zero, input: 10, cacheRead: 30 } },
  cacheHit: [],
});

function fake(
  id: string,
  answers: Record<string, unknown>,
  options: { delayMs?: number; status?: number } = {},
): NodeTransport & { request: ReturnType<typeof vi.fn> } {
  return {
    machineId: id,
    hello: () => createNodeHello(),
    request: vi.fn(async (req: { path: string }, signal: AbortSignal) => {
      if (options.delayMs)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.delayMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      return {
        status: options.status ?? 200,
        contentType: 'application/json',
        body: (async function* () {
          yield new TextEncoder().encode(JSON.stringify(answers[req.path]));
        })(),
      };
    }),
    subscribe: () => () => {},
    snapshot: async () => ({ projects: [], sessions: [], control: [] }),
    close: () => {},
  } as never;
}

function setup(
  entries: {
    id: string;
    transport: NodeTransport | null;
    state?: 'online' | 'offline';
    snapshot?: NodeSnapshot | null;
  }[],
  timeoutMs = 5000,
) {
  const machines = new Machines(null);
  for (const e of entries)
    machines.add({
      summary: {
        ...createNodeHello(),
        machineId: e.id,
        state: e.state ?? 'online',
        lastSeenAt: null,
        outdated: false,
      },
      transport: e.transport,
      snapshot: e.snapshot ?? null,
    } satisfies HubMachine);
  const app = new Hono();
  app.use('/api/*', mergedEndpoints(machines, timeoutMs));
  app.all('/api/*', (c) => c.json({ relayed: c.req.path }));
  return app;
}

afterEach(() => vi.useRealTimers());

describe('merged endpoints', () => {
  it('keeps the same projectId on two machines separate and stamps machineId', async () => {
    const a = fake('a', { '/projects': { projects: [project('p1', 1)] } });
    const b = fake('b', { '/projects': { projects: [project('p1', 2)] } });
    const app = setup([
      { id: 'a', transport: a },
      { id: 'b', transport: b },
    ]);
    const body = (await (
      await app.request('/api/projects')
    ).json()) as ProjectsResponse;
    expect(body.partial).toEqual([]);
    expect(
      body.projects.map((p) => [p.machineId, p.id, p.costUsd, p.offline]),
    ).toEqual([
      ['a', 'p1', 1, undefined],
      ['b', 'p1', 2, undefined],
    ]);
  });

  it('merges overview and usage totals and tags usage projects', async () => {
    const a = fake('a', { '/overview': overview(1), '/usage': usage(1, 'p1') });
    const b = fake('b', { '/overview': overview(2), '/usage': usage(2, 'p1') });
    const app = setup([
      { id: 'a', transport: a },
      { id: 'b', transport: b },
    ]);
    const o = (await (
      await app.request('/api/overview')
    ).json()) as OverviewResponse;
    expect(o).toMatchObject({
      projectCount: 2,
      sessionCount: 4,
      costUsd: 3,
      partial: [],
      columns: { inactive: 4 },
      daily: [{ date: '2026-10-25', messages: 2 }],
      byModel: [{ model: 'm', costUsd: 3 }],
    });
    const u = (await (
      await app.request('/api/usage?tz=UTC')
    ).json()) as UsageResponse;
    expect(u.totals.costUsd).toBe(3);
    expect(u.days).toHaveLength(1);
    expect(u.cacheHit).toEqual([{ date: '2026-10-25', ratio: 0.75 }]);
    expect(u.byProject.map((p) => [p.machineId, p.projectId])).toEqual([
      ['b', 'p1'],
      ['a', 'p1'],
    ]);
    expect(a.request.mock.calls[1]![0]).toMatchObject({
      path: '/usage',
      query: { tz: 'UTC' },
    });
  });

  it('leaves a machine slower than the merge timeout out and names it in partial', async () => {
    const fast = fake('fast', {
      '/projects': { projects: [project('p1')] },
      '/overview': overview(1),
    });
    const slow = fake(
      'slow',
      { '/projects': { projects: [project('p2')] } },
      { delayMs: 60_000 },
    );
    const app = setup(
      [
        { id: 'fast', transport: fast },
        { id: 'slow', transport: slow },
      ],
      20,
    );
    const body = (await (
      await app.request('/api/projects')
    ).json()) as ProjectsResponse;
    expect(body.projects.map((p) => p.machineId)).toEqual(['fast']);
    expect(body.partial).toEqual(['slow']);
    const o = (await (
      await app.request('/api/overview')
    ).json()) as OverviewResponse;
    expect(o.partial).toEqual(['slow']);
    expect(o.costUsd).toBe(1);
  }, 10_000);

  it('treats an erroring or malformed machine as partial', async () => {
    const ok = fake('ok', { '/projects': { projects: [] } });
    const bad = fake('bad', { '/projects': { error: 'x' } }, { status: 503 });
    const junk = fake('junk', { '/projects': { nope: true } });
    const app = setup([
      { id: 'ok', transport: ok },
      { id: 'bad', transport: bad },
      { id: 'junk', transport: junk },
    ]);
    const body = (await (
      await app.request('/api/projects')
    ).json()) as ProjectsResponse;
    expect(body.partial).toEqual(['bad', 'junk']);
  });

  it('reads online machines live and uses the snapshot only for offline ones', async () => {
    const live = fake('live', {
      '/projects': { projects: [project('fresh')] },
      '/overview': overview(1),
    });
    const gone = fake('gone', {
      '/projects': { projects: [project('live-data')] },
    });
    const snapshot: NodeSnapshot = {
      projects: [project('stale')],
      sessions: [],
      control: [],
    };
    const app = setup([
      // An online machine's snapshot is ignored.
      {
        id: 'live',
        transport: live,
        snapshot: { projects: [project('ignored')], sessions: [], control: [] },
      },
      { id: 'gone', transport: gone, state: 'offline', snapshot },
    ]);
    const body = (await (
      await app.request('/api/projects')
    ).json()) as ProjectsResponse;
    expect(body.projects.map((p) => [p.machineId, p.id, p.offline])).toEqual([
      ['live', 'fresh', undefined],
      ['gone', 'stale', true],
    ]);
    expect(live.request).toHaveBeenCalledTimes(1);
    expect(gone.request).not.toHaveBeenCalled();
    const o = (await (
      await app.request('/api/overview')
    ).json()) as OverviewResponse;
    expect(o.offline).toEqual(['gone']);
    expect(o.partial).toEqual([]);
  });

  it('names an offline machine without a snapshot and adds nothing for it', async () => {
    const live = fake('live', { '/overview': overview(1) });
    const app = setup([
      { id: 'live', transport: live },
      { id: 'gone', transport: null, state: 'offline' },
    ]);
    const o = (await (
      await app.request('/api/overview')
    ).json()) as OverviewResponse;
    expect(o).toMatchObject({
      projectCount: 1,
      offline: ['gone'],
      partial: [],
    });
  });

  it('falls through to the alias with only local, other paths and other methods', async () => {
    const local = fake('local', {});
    const only = setup([{ id: 'local', transport: local }]);
    expect(await (await only.request('/api/projects')).json()).toEqual({
      relayed: '/api/projects',
    });
    expect(local.request).not.toHaveBeenCalled();
    const two = setup([
      { id: 'local', transport: local },
      { id: 'b', transport: fake('b', {}) },
    ]);
    expect(await (await two.request('/api/search')).json()).toEqual({
      relayed: '/api/search',
    });
    expect(
      await (await two.request('/api/projects', { method: 'POST' })).json(),
    ).toEqual({ relayed: '/api/projects' });
  });

  it('parses C9VIEW_MERGE_TIMEOUT_MS', () => {
    expect(loadMergeTimeoutMs({})).toBe(5000);
    expect(loadMergeTimeoutMs({ C9VIEW_MERGE_TIMEOUT_MS: '250' })).toBe(250);
    for (const bad of ['0', '-1', '1.5', 'x', ''])
      expect(() =>
        loadMergeTimeoutMs({ C9VIEW_MERGE_TIMEOUT_MS: bad }),
      ).toThrow(/C9VIEW_MERGE_TIMEOUT_MS/);
  });
});

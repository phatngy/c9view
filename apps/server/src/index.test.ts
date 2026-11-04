import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  appendFile,
  mkdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import type {
  GlobalConfigResponse,
  HealthResponse,
  OverviewResponse,
  ProjectDetailResponse,
  ProjectsResponse,
  SessionDetailResponse,
} from '@c9view/api';
import { createApp } from './app.js';
import { DataStore } from './data/store.js';

let dir: string;
let claudeDir: string;
let app: ReturnType<typeof createApp>;
const secret = 'sk-ant-fixture-super-secret-value-123456789';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-server-'));
  claudeDir = join(dir, 'claude');
  await cp(
    fileURLToPath(new URL('../test/fixtures/claude', import.meta.url)),
    claudeDir,
    { recursive: true },
  );
  for (const [project, sessions] of [
    ['alpha', ['s1', 's2']],
    ['beta', ['s3']],
  ] as const) {
    const cwd = join(dir, project);
    await mkdir(join(cwd, '.claude'), { recursive: true });
    await writeFile(
      join(cwd, '.claude/settings.json'),
      JSON.stringify({
        env: { PROJECT_SECRET: secret },
        permissions: { allow: ['Read'] },
      }),
    );
    for (const session of sessions) {
      const path = join(
        claudeDir,
        'projects',
        `-fixture-${project}`,
        `${session}.jsonl`,
      );
      const contents = await readFile(path, 'utf8');
      await writeFile(
        path,
        contents.replaceAll(`__${project.toUpperCase()}_CWD__`, cwd),
      );
    }
  }
  await mkdir(join(claudeDir, 'sessions'));
  for (const [sessionId, status] of [
    ['s1', 'idle'],
    ['s3', 'busy'],
  ])
    await writeFile(
      join(claudeDir, 'sessions', `${process.pid}-${sessionId}.json`),
      JSON.stringify({
        pid: process.pid,
        sessionId,
        status,
        name: 'Fixture ' + secret,
        statusUpdatedAt: new Date().toISOString(),
        extra: true,
      }),
    );
  await writeFile(join(claudeDir, 'sessions/broken.json'), '{');
  const webDist = join(dir, 'web');
  await mkdir(webDist);
  await writeFile(join(webDist, 'index.html'), '<html>fixture SPA</html>');
  await writeFile(join(webDist, 'asset.js'), '/* fixture asset */');
  app = createApp(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }), { webDist });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function get<T>(path: string): Promise<T> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(secret);
  expect(text).not.toContain('arbitrary-fixture-value-123');
  return JSON.parse(text) as T;
}
describe('fixture HTTP contract', () => {
  it('reports health with the configured data directory', async () => {
    expect(await get<HealthResponse>('/api/health')).toMatchObject({
      ok: true,
      version: '0.0.0',
      claudeDir,
    });
  });
  it('aggregates overview counts, tokens, daily activity and model costs', async () => {
    const response = await get<OverviewResponse>('/api/overview');
    expect(response).toMatchObject({
      projectCount: 2,
      sessionCount: 3,
      liveSessionCount: 2,
      columns: { inactive: 1, in_progress: 1, need_input: 1, in_review: 0 },
      daily: [{ date: '2026-10-25', messages: 7, sessions: 3, toolCalls: 3 }],
    });
    // Parent sessions (500/100/50/25/15) plus the s1 subagent
    // (100/20/10/5/3): subagent usage rolls up into its parent.
    expect(response.tokens).toEqual({
      input: 600,
      output: 120,
      cacheRead: 60,
      cacheCreation: 30,
      thinking: 18,
    });
    expect(response.costUsd).toBeGreaterThan(0);
    expect(
      response.byModel.find((m) => m.model === 'unknown-model')?.costUsd,
    ).toBe(0);
    expect(response.byModel.reduce((sum, m) => sum + m.costUsd, 0)).toBe(
      response.costUsd,
    );
  });
  it('lists projects using basenames of resolved cwd paths', async () => {
    const response = await get<ProjectsResponse>('/api/projects');
    expect(response.projects).toHaveLength(2);
    expect(
      response.projects.find((p) => p.id === '-fixture-alpha'),
    ).toMatchObject({
      name: 'alpha',
      path: join(dir, 'alpha'),
      pathExists: true,
      sessionCount: 2,
      columns: { need_input: 1, inactive: 1 },
    });
    for (const project of response.projects) {
      const detail = await get<ProjectDetailResponse>(
        `/api/projects/${project.id}`,
      );
      expect(detail.project).toEqual(project);
      expect(detail.sessions).toHaveLength(project.sessionCount);
      expect(Object.keys(detail.config).sort()).toEqual([
        'agents',
        'commands',
        'hooks',
        'instructions',
        'mcpServers',
        'memory',
        'settings',
        'skills',
      ]);
      expect(detail.config.settings.env).not.toEqual({
        PROJECT_SECRET: secret,
      });
    }
  });
  it('returns parent-only messages, links subagents and detects pending tools', async () => {
    const response = await get<SessionDetailResponse>(
      '/api/projects/-fixture-alpha/sessions/s1',
    );
    expect(response.session).toMatchObject({
      id: 's1',
      projectId: '-fixture-alpha',
      subagentCount: 1,
      status: {
        column: 'need_input',
        reason: 'waiting on tool call: AskUserQuestion',
      },
    });
    expect(response.subagents).toEqual([
      {
        agentId: 'child',
        description: 'Fixture child',
        parentToolUseId: 'agent-call',
      },
    ]);
    expect(response.messages).toHaveLength(5);
    expect(response.totalMessages).toBe(5);
    expect(response.messages.some((m) => m.uuid === 'child-u')).toBe(false);
    expect(response.permissionModes).toEqual(['default']);
    expect(response.toolUseCounts).toEqual({ Agent: 1, AskUserQuestion: 1 });
    expect(response.nextCursor).toBeNull();
    const input = response.messages
      .flatMap((m) => m.blocks)
      .find((b) => b.type === 'tool_use' && b.name === 'AskUserQuestion');
    expect(input?.type).toBe('tool_use');
    if (input?.type === 'tool_use') {
      expect(String(input.input).length).toBe(20_000);
      expect(String(input.input)).toContain('… truncated');
    }
  });
  it('joins and caps tool results and preserves errors', async () => {
    const response = await get<SessionDetailResponse>(
      '/api/projects/-fixture-alpha/sessions/s2',
    );
    expect(response.session.costUsd).toBe(0);
    expect(response.errorCount).toBe(1);
    const result = response.messages
      .flatMap((m) => m.blocks)
      .find((b) => b.type === 'tool_result');
    expect(result).toMatchObject({
      type: 'tool_result',
      isError: true,
      toolUseId: 'read',
    });
    if (result?.type === 'tool_result') {
      expect(result.text).toContain('\nyyyyy');
      expect(result.text.length).toBe(20_000);
      expect(result.text.endsWith('… truncated')).toBe(true);
    }
  });
  it('paginates messages and tolerates invalid parameters', async () => {
    const path = '/api/projects/-fixture-alpha/sessions/s1';
    const first = await get<SessionDetailResponse>(path + '?limit=2');
    const next = await get<SessionDetailResponse>(path + '?cursor=2&limit=2');
    expect(first.messages).toHaveLength(2);
    expect(first.cursor).toBe(0);
    expect(first.prevCursor).toBeNull();
    expect(first.nextCursor).toBe(2);
    expect(next.cursor).toBe(2);
    expect(next.prevCursor).toBe(0);
    expect(next.messages[0]?.uuid).toBe('u2');
    expect(next.nextCursor).toBe(4);
    expect(
      (await get<SessionDetailResponse>(path + '?cursor=999999999')).messages,
    ).toEqual([]);
    expect(
      (await get<SessionDetailResponse>(path + '?cursor=-2&limit=nope'))
        .messages,
    ).toHaveLength(5);
    expect(
      (await get<SessionDetailResponse>(path + '?limit=0')).messages,
    ).toHaveLength(1);
  });
  it('serves tail pages with absolute cursors and ignores cursor in tail mode', async () => {
    const path = '/api/projects/-fixture-alpha/sessions/s1';
    const tail = await get<SessionDetailResponse>(path + '?from=end&limit=2');
    expect(tail.messages.map((m) => m.uuid)).toEqual(['a2', 'sys1']);
    expect(tail).toMatchObject({
      cursor: 3,
      prevCursor: 1,
      nextCursor: null,
      totalMessages: 5,
    });
    expect(
      await get<SessionDetailResponse>(path + '?from=end&cursor=1&limit=2'),
    ).toEqual(tail);
    const one = await get<SessionDetailResponse>(path + '?from=end&limit=0');
    expect(one.messages).toHaveLength(1);
    expect(one.cursor).toBe(4);
    expect(one.prevCursor).toBe(3);
    const defaults = await get<SessionDetailResponse>(path + '?from=end');
    expect(defaults.messages).toHaveLength(5);
    expect(defaults.cursor).toBe(0);
    expect(defaults.prevCursor).toBeNull();
    const clamped = await get<SessionDetailResponse>(
      path + '?cursor=999&limit=2',
    );
    expect(clamped).toMatchObject({
      cursor: 5,
      prevCursor: 3,
      nextCursor: null,
      messages: [],
    });
    expect(
      await get<SessionDetailResponse>(path + '?from=bogus&limit=2'),
    ).toEqual(await get<SessionDetailResponse>(path + '?limit=2'));
  });
  it('keeps absolute history cursors stable when the transcript grows', async () => {
    const file = join(claudeDir, 'projects/-fixture-beta/growing.jsonl');
    const records = (start: number, count: number) =>
      Array.from(
        { length: count },
        (_, i) =>
          JSON.stringify({
            type: 'user',
            uuid: `growth-${start + i}`,
            message: { content: 'growth' },
          }) + '\n',
      ).join('');
    await writeFile(file, records(0, 10));
    try {
      const path = '/api/projects/-fixture-beta/sessions/growing';
      const initial = await get<SessionDetailResponse>(
        path + '?from=end&limit=2',
      );
      expect(initial).toMatchObject({
        cursor: 8,
        prevCursor: 6,
        nextCursor: null,
        totalMessages: 10,
      });
      await appendFile(file, records(10, 2));
      const latest = await get<SessionDetailResponse>(
        path + '?from=end&limit=2',
      );
      expect(latest).toMatchObject({
        cursor: 10,
        prevCursor: 8,
        nextCursor: null,
        totalMessages: 12,
      });
      const history = await get<SessionDetailResponse>(
        path + `?cursor=${initial.prevCursor}&limit=2`,
      );
      expect(history.messages.map((m) => m.uuid)).toEqual([
        'growth-6',
        'growth-7',
      ]);
      expect(history).toMatchObject({
        cursor: 6,
        prevCursor: 4,
        nextCursor: 8,
      });
    } finally {
      await rm(file);
    }
  });
  it('enforces the 1000-message maximum and 200-message default', async () => {
    const path = join(claudeDir, 'projects/-fixture-beta/paging.jsonl');
    await writeFile(
      path,
      Array.from(
        { length: 1002 },
        (_, i) =>
          JSON.stringify({
            type: 'user',
            uuid: `page-${i}`,
            cwd: join(dir, 'beta'),
            message: { content: 'paging' },
          }) + '\n',
      ).join(''),
    );
    try {
      const url = '/api/projects/-fixture-beta/sessions/paging';
      expect((await get<SessionDetailResponse>(url)).messages).toHaveLength(
        200,
      );
      const max = await get<SessionDetailResponse>(url + '?limit=9999');
      expect(max.messages).toHaveLength(1000);
      expect(max.nextCursor).toBe(1000);
      const tail = await get<SessionDetailResponse>(
        url + '?from=end&limit=9999',
      );
      expect(tail.messages).toHaveLength(1000);
      expect(tail).toMatchObject({
        cursor: 2,
        prevCursor: 0,
        nextCursor: null,
      });
      const defaults = await get<SessionDetailResponse>(url + '?from=end');
      expect(defaults.messages).toHaveLength(200);
      expect(defaults.cursor).toBe(802);
    } finally {
      await rm(path);
    }
  });
  it('prices each assistant request before aggregating long-context usage', async () => {
    const path = join(claudeDir, 'projects/-fixture-beta/pricing.jsonl');
    await writeFile(
      path,
      [1, 2]
        .map(
          (id) =>
            JSON.stringify({
              type: 'assistant',
              message: {
                id: `price-${id}`,
                model: 'claude-haiku-5-5',
                content: [],
                usage: { input_tokens: 60_000 },
              },
            }) + '\n',
        )
        .join(''),
    );
    try {
      const response = await get<SessionDetailResponse>(
        '/api/projects/-fixture-beta/sessions/pricing',
      );
      expect(response.session.tokens.input).toBe(120_000);
      expect(response.session.costUsd).toBeCloseTo(0.012);
      expect(response.byModel[0]?.costUsd).toBeCloseTo(0.012);
    } finally {
      await rm(path);
    }
  });
  it('returns global redacted config and project memory', async () => {
    const config = await get<GlobalConfigResponse>('/api/config');
    expect(config.settings.env).toEqual({
      FAKE_SECRET: expect.stringMatching(/^«redacted:/),
      PLAIN_SECRET: expect.stringMatching(/^«redacted:/),
    });
    expect(config.provenance).toHaveProperty('/env/FAKE_SECRET', 'user');
    expect(config.hooks).toEqual([
      { event: 'Stop', matcher: null, command: 'echo fixture', scope: 'user' },
    ]);
    expect(config.mcpServers).toEqual([
      { name: 'fixture', transport: 'stdio', scope: 'user' },
    ]);
    expect(config.instructions).toHaveLength(1);
    const detail = await get<ProjectDetailResponse>(
      '/api/projects/-fixture-alpha',
    );
    expect(detail.config.memory).toHaveLength(2);
    expect(
      detail.config.memory.find((m) => m.name === 'Fixture note')?.type,
    ).toBe('project');
  });
  it('returns JSON ApiErrors for missing resources, traversal and unknown API paths', async () => {
    for (const path of [
      '/api/projects/missing',
      '/api/projects/-fixture-alpha/sessions/missing',
      '/api/projects/%2E%2E%2Fsecret',
      '/api/projects/-fixture-alpha/sessions/%2E%2E%2Fsecret',
      '/api/nope',
      '/api',
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    }
  });
  it('returns sanitized 500 errors without exposing underlying failure text', async () => {
    const store = new DataStore(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
    store.snapshot = () => Promise.reject(new Error(secret));
    const broken = createApp(store.config, { store });
    const response = await broken.request('/api/projects');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });
  it('serves static assets and SPA fallback outside the API', async () => {
    expect(await (await app.request('/asset.js')).text()).toBe(
      '/* fixture asset */',
    );
    for (const path of ['/', '/projects/fixture']) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('fixture SPA');
    }
  });
  it('warms summary entries without retaining full messages', async () => {
    const store = new DataStore(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
    await store.cache.warm(claudeDir);
    expect(store.cache.retainedRecordCount).toBe(0);
    expect((await store.snapshot()).flatMap((p) => p.sessions)).toHaveLength(3);
  });
});

it('rejects untrusted Host and Origin headers across API and static routes', async () => {
  for (const path of ['/api/health', '/']) {
    for (const host of [
      'evil.example',
      'localhost.evil.example',
      'evil.example:7777',
      'localhost@evil.example',
      'localhost/path',
    ]) {
      const response = await app.request(path, { headers: { host } });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden' });
    }
    for (const origin of [
      'https://evil.example',
      'null',
      'invalid',
      'https://localhost.evil.example',
    ]) {
      expect(
        (
          await app.request(path, {
            headers: { host: 'localhost:7777', origin },
          })
        ).status,
      ).toBe(403);
    }
  }
  for (const host of ['localhost:7777', '127.0.0.1', '[::1]:7777']) {
    expect(
      (
        await app.request('/api/health', {
          headers: { host, origin: `http://${host}` },
        })
      ).status,
    ).toBe(200);
  }
  vi.stubEnv('HOST', 'dashboard.internal');
  vi.stubEnv('C9VIEW_ALLOWED_HOSTS', ' tunnel.example, second.example ');
  try {
    const configured = createApp(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
    for (const host of [
      'dashboard.internal:7777',
      'tunnel.example',
      'second.example:443',
    ]) {
      expect(
        (
          await configured.request('/api/health', {
            headers: { host, origin: `https://${host}` },
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await configured.request('/api/health', {
          headers: { host: 'tunnel.example', origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
  } finally {
    vi.unstubAllEnvs();
  }
});
it('polls one session without a snapshot, messages or subagent discovery', async () => {
  const store = new DataStore(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
  const snapshot = vi
    .spyOn(store, 'snapshot')
    .mockRejectedValue(new Error('snapshot must not run'));
  const mapped = vi.spyOn(store.cache, 'mapped');
  const isolated = createApp(store.config, { store });
  const path = '/api/projects/-fixture-alpha/sessions/s1';
  const detail = (await (
    await isolated.request(path)
  ).json()) as SessionDetailResponse;
  mapped.mockClear();
  const status = await isolated.request(path + '/status');
  expect(status.status).toBe(200);
  expect(await status.json()).toEqual({
    status: detail.session.status,
    totalMessages: detail.totalMessages,
    lastAt: detail.session.lastAt,
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(mapped).not.toHaveBeenCalled();
  expect(
    (await isolated.request('/api/projects/missing/sessions/missing/status'))
      .status,
  ).toBe(404);
});
it('coalesces snapshots and expires the cached result after 1.5 seconds', async () => {
  const store = new DataStore(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const reads = vi.spyOn(store.cache, 'get');
  try {
    const first = store.snapshot();
    expect(store.snapshot()).toBe(first);
    const value = await first;
    reads.mockClear();
    now += 1499;
    expect(await store.snapshot()).toBe(value);
    expect(reads).not.toHaveBeenCalled();
    now += 1;
    expect(await store.snapshot()).not.toBe(value);
    expect(reads).toHaveBeenCalled();
  } finally {
    clock.mockRestore();
  }
});
it('logs method, path, message and stack while returning a generic error', async () => {
  const store = new DataStore(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
  const error = new Error('fixture failure');
  vi.spyOn(store, 'snapshot').mockRejectedValue(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await createApp(store.config, { store }).request(
      '/api/projects',
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      method: 'GET',
      path: '/api/projects',
      message: 'fixture failure',
      stack: error.stack,
    });
  } finally {
    log.mockRestore();
  }
});

it('never returns the fake secret from transcript text, tool input/result, config, instructions, memory or settings', async () => {
  const isolated = createApp(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
  // The fixture embeds this secret in transcript text/tool inputs/tool results,
  // global CLAUDE.md/settings and project memory; setup adds project settings.
  for (const path of [
    '/api/health',
    '/api/config',
    '/api/overview',
    '/api/projects',
    '/api/projects/-fixture-alpha',
    '/api/projects/-fixture-beta',
    '/api/projects/-fixture-alpha/sessions/s1',
    '/api/projects/-fixture-alpha/sessions/s2',
    '/api/projects/-fixture-beta/sessions/s3',
    '/api/projects/-fixture-alpha/sessions/s1/status',
  ]) {
    // Exercise both initial mapping and cached responses.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await isolated.request(path);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(secret);
      expect(text).not.toContain('arbitrary-fixture-value-123');
    }
  }
});

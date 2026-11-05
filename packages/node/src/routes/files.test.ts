import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import type {
  FileContentResponse,
  FileListResponse,
  GitDiffResponse,
  GitStatusResponse,
  SessionChangesResponse,
  SessionFileDiffResponse,
  SessionDetailResponse,
} from '@c9view/api';
import { createApp } from '../test-app.js';
let dir: string, app: ReturnType<typeof createApp>;
const base = '/api/projects/-fixture-files';
const secret = 'sk-ant-fixture-secret-1234567890';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-file-routes-'));
  vi.stubEnv('C9VIEW_STATE_DIR', join(dir, 'state'));
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', join(dir, 'legacy'));
  const root = join(dir, 'project'),
    claude = join(dir, 'claude');
  await mkdir(root);
  await mkdir(join(claude, 'projects/-fixture-files'), { recursive: true });
  await writeFile(join(root, 'file.ts'), 'before\n');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      { cwd: root },
    );
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  await writeFile(join(root, 'file.ts'), `after ${secret}\n`);
  await writeFile(join(root, 'new.ts'), 'new\n');
  await writeFile(join(root, '.env'), secret);
  await writeFile(join(root, 'large'), 'x'.repeat(1_000_001));
  await writeFile(join(root, 'binary'), Buffer.from([0, 1]));
  await symlink(dir, join(root, 'escape'));
  const records = [
    {
      type: 'assistant',
      uuid: 'a',
      cwd: root,
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        id: 'a',
        model: 'fixture',
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'Write',
            input: {
              file_path: join(root, 'file.ts'),
              content: `after ${secret}\n`,
            },
          },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'b',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't', content: 'done' }],
      },
      toolUseResult: { originalFile: 'before\n', type: 'update' },
    },
  ];
  await writeFile(
    join(claude, 'projects/-fixture-files/s.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  await mkdir(join(claude, 'projects/-fixture-missing'));
  await writeFile(
    join(claude, 'projects/-fixture-missing/s.jsonl'),
    JSON.stringify({
      type: 'user',
      cwd: join(dir, 'missing'),
      message: { content: 'fixture' },
    }) + '\n',
  );
  await mkdir(join(claude, 'projects/-fixture-plain'));
  await writeFile(
    join(claude, 'projects/-fixture-plain/s.jsonl'),
    JSON.stringify({
      type: 'user',
      cwd: dir,
      message: { content: 'fixture' },
    }) + '\n',
  );
  app = createApp(loadConfig({ C9VIEW_CLAUDE_DIR: claude }));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function get<T>(path: string): Promise<T> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain(secret);
  return JSON.parse(text) as T;
}
describe('files and changes HTTP routes', () => {
  it('serves list, redacted content, limits, status and parsed diffs', async () => {
    expect(
      (await get<FileListResponse>(`${base}/files`)).entries,
    ).toContainEqual(expect.objectContaining({ name: '.env', denied: true }));
    expect(
      await get<FileContentResponse>(`${base}/file?path=file.ts`),
    ).toMatchObject({ binary: false, tooLarge: false, language: 'typescript' });
    expect(
      await get<FileContentResponse>(`${base}/file?path=large`),
    ).toMatchObject({ tooLarge: true });
    expect(
      await get<FileContentResponse>(`${base}/file?path=binary`),
    ).toMatchObject({ binary: true });
    expect(await get<GitStatusResponse>(`${base}/git/status`)).toMatchObject({
      isRepo: true,
    });
    expect(
      (await get<GitDiffResponse>(`${base}/git/diff?path=new.ts`)).files[0]
        ?.hunks[0]?.lines,
    ).toContain('+new');
    expect(
      await get<GitStatusResponse>('/api/projects/-fixture-plain/git/status'),
    ).toEqual({ isRepo: false });
  });
  it('serves net and step diffs and attaches inline changes to tool messages', async () => {
    const response = await get<SessionChangesResponse>(
      `${base}/sessions/s/changes`,
    );
    expect(response.files[0]).toMatchObject({
      relPath: 'file.ts',
      kind: 'update',
      additions: 1,
      deletions: 1,
    });
    const diff = await get<SessionFileDiffResponse>(
      `${base}/sessions/s/changes/${response.files[0]!.fileId}`,
    );
    expect(diff).toMatchObject({
      source: 'tool-hunks',
      partial: false,
      tooLarge: false,
    });
    expect(diff.steps).toHaveLength(1);
    const messages = await get<SessionDetailResponse>(`${base}/sessions/s`);
    expect(messages.messages[0]?.blocks[0]).toMatchObject({
      type: 'tool_use',
      change: { kind: 'update', additions: 1, deletions: 1, truncated: false },
    });
    expect(
      (await app.request(`${base}/sessions/s/changes/no-such-file`)).status,
    ).toBe(404);
    expect((await app.request(`${base}/sessions/missing/changes`)).status).toBe(
      404,
    );
  });
});

it('rejects git metadata through both file HTTP endpoints', async () => {
  for (const path of [
    '.git/config',
    '.git/HEAD',
    './.git/config',
    '.git/../.git/config',
    '.git%2fconfig',
    '.GIT/config',
  ]) {
    for (const endpoint of ['file', 'files']) {
      expect(
        (
          await app.request(
            `${base}/${endpoint}?path=${encodeURIComponent(path)}`,
          )
        ).status,
      ).toBe(400);
    }
  }
  expect((await app.request(`${base}/file?path=.git%2fconfig`)).status).toBe(
    400,
  );
});

describe('file and git budgets', () => {
  it('returns metadata and a too-large notice for a file over the file budget', async () => {
    const small = createApp(
      loadConfig({ C9VIEW_CLAUDE_DIR: join(dir, 'claude') }),
      {
        limits: { fileBudgetBytes: 64 },
      },
    );
    const response = await small.request(`${base}/file?path=file.ts`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as FileContentResponse;
    expect(body).toMatchObject({
      path: 'file.ts',
      tooLarge: true,
      notice: 'too-large',
      language: 'typescript',
    });
    expect(body).not.toHaveProperty('content');
    expect(body.size).toBeGreaterThan(0);
    expect(
      await get<FileContentResponse>(`${base}/file?path=large`),
    ).toMatchObject({ tooLarge: true, notice: 'too-large' });
    expect(
      await get<FileContentResponse>(`${base}/file?path=file.ts`),
    ).not.toHaveProperty('notice');
  });

  it('pages listings, git status, diffs and changes under the page budget', async () => {
    const budget = 300;
    const small = createApp(
      loadConfig({ C9VIEW_CLAUDE_DIR: join(dir, 'claude') }),
      {
        limits: { pageBudgetBytes: budget },
      },
    );
    async function all<T extends { nextCursor?: string | null }>(
      path: string,
      items: (page: T) => unknown[],
    ) {
      const collected: unknown[] = [];
      let cursor: string | null | undefined = undefined;
      let pages = 0;
      do {
        const separator = path.includes('?') ? '&' : '?';
        const response = await small.request(
          cursor === undefined ? path : `${path}${separator}cursor=${cursor}`,
        );
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(secret);
        const body = JSON.parse(text) as T;
        const list = items(body);
        // A page over budget only holds one item that could not be cut.
        if (Buffer.byteLength(text) > budget) expect(list).toHaveLength(1);
        collected.push(...list);
        cursor = body.nextCursor;
        pages++;
      } while (cursor);
      return { collected, pages };
    }
    const listing = await all<FileListResponse>(
      `${base}/files`,
      (p) => p.entries,
    );
    expect(listing.pages).toBeGreaterThan(1);
    expect(listing.collected).toEqual(
      (await get<FileListResponse>(`${base}/files`)).entries,
    );
    const status = await all<
      GitStatusResponse & { nextCursor?: string | null }
    >(`${base}/git/status`, (p) => (p.isRepo ? p.files : []));
    const full = await get<GitStatusResponse>(`${base}/git/status`);
    expect(status.collected).toEqual(full.isRepo ? full.files : []);
    const diff = await all<GitDiffResponse>(`${base}/git/diff`, (p) => p.files);
    expect(diff.collected.map((f) => (f as { path: string }).path)).toEqual(
      (await get<GitDiffResponse>(`${base}/git/diff`)).files.map((f) => f.path),
    );
    const changes = await all<SessionChangesResponse>(
      `${base}/sessions/s/changes`,
      (p) => p.files,
    );
    expect(changes.collected).toEqual(
      (await get<SessionChangesResponse>(`${base}/sessions/s/changes`)).files,
    );
    expect((await small.request(`${base}/files?cursor=-1`)).status).toBe(400);
    expect((await small.request(`${base}/git/diff?cursor=x`)).status).toBe(400);
  });

  it('cuts one diff larger than the budget and marks it truncated', async () => {
    const response = await createApp(
      loadConfig({ C9VIEW_CLAUDE_DIR: join(dir, 'claude') }),
      { limits: { pageBudgetBytes: 120 } },
    ).request(`${base}/git/diff?path=file.ts`);
    const body = (await response.json()) as GitDiffResponse;
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({ path: 'file.ts', truncated: true });
  });
});

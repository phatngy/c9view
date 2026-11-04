import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { loadConfig } from '@c9view/core';
import { createApp } from './app.js';
let dir: string, app: ReturnType<typeof createApp>;
const base = '/api/projects/-fixture-files';
const secret = 'sk-ant-fixture-secret-1234567890';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-file-routes-'));
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
  await rm(dir, { recursive: true, force: true });
});
it('enforces path boundaries, missing-project responses and global host/origin guards', async () => {
  for (const path of [
    '../outside',
    '/etc/passwd',
    '.env',
    'escape',
    '%2e%2e/outside',
  ])
    expect(
      (await app.request(`${base}/file?path=${encodeURIComponent(path)}`))
        .status,
    ).toBe(400);
  for (const suffix of [
    '/files',
    '/file?path=x',
    '/git/status',
    '/git/diff',
    '/sessions/s/changes',
  ])
    expect(
      (await app.request(`/api/projects/-fixture-missing${suffix}`)).status,
    ).toBe(404);
  expect(
    (
      await app.request(`${base}/files`, {
        headers: { host: 'evil.invalid' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(`${base}/sessions/s/changes`, {
        headers: { origin: 'https://evil.invalid' },
      })
    ).status,
  ).toBe(403);
});

import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeApp } from '../app.js';
import { setupControl } from '../control/test-support.js';
import type { NodeRuntime } from '../runtime.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
async function app(roots: boolean) {
  const t = await setupControl({}, { roots });
  cleanups.push(t.close);
  const a = createNodeApp({
    store: t.store,
    control: t.service,
    controlConfig: t.config,
  } as unknown as NodeRuntime);
  return { t, a };
}
const post = (
  a: ReturnType<typeof createNodeApp>,
  bootId: string,
  body: unknown,
) =>
  a.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-c9view-boot-id': bootId },
    body: JSON.stringify(body),
  });

it('T063 T068 without roots every project route answers 404', async () => {
  const { t, a } = await app(false);
  expect((await a.request('/workspace/roots')).status).toBe(404);
  expect((await a.request('/workspace/browse')).status).toBe(404);
  const res = await post(a, t.bootId, {
    clientRequestId: randomUUID(),
    location: '/x',
    text: 'hi',
  });
  expect(res.status).toBe(404);
});
it('T068 with roots: lists roots, browses and validates the body', async () => {
  const { t, a } = await app(true);
  const roots = (await (await a.request('/workspace/roots')).json()) as {
    roots: string[];
  };
  expect(roots.roots).toHaveLength(1);
  expect(
    (await a.request(`/workspace/browse?path=${encodeURIComponent('/')}`))
      .status,
  ).toBe(400);
  expect((await a.request('/workspace/browse')).status).toBe(200);
  expect(
    (
      await post(a, t.bootId, {
        clientRequestId: randomUUID(),
        location: join(t.work, 'x'),
        text: 'hi',
        extra: 1,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post(a, t.bootId, {
        clientRequestId: randomUUID(),
        location: join(t.work, 'x'),
        text: 'hi',
        permissionMode: 'bypassPermissions',
      })
    ).status,
  ).toBe(400);
  const escape = await post(a, t.bootId, {
    clientRequestId: randomUUID(),
    location: '/etc/x',
    text: 'hi',
  });
  expect(escape.status).toBe(400);
  expect(await escape.json()).toMatchObject({ reason: 'outside-roots' });
  const url = await post(a, t.bootId, {
    clientRequestId: randomUUID(),
    location: join(t.work, 'x'),
    gitUrl: 'file:///x',
    text: 'hi',
  });
  expect(await url.json()).toMatchObject({ reason: 'bad-url' });
});
it('T068 git-write.ts is the only module that spawns git, and createGit is not used by writers', async () => {
  const base = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts'))
        files.push(join(dir, entry.name));
    }
  }
  await walk(base);
  const spawners: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (/['"]git['"]\s*,/.test(text) && /child_process/.test(text))
      spawners.push(file);
    if (file.includes('/projects/') || file.includes('/labels/'))
      expect(text, file).not.toMatch(/\bcreateGit\b/);
  }
  expect(spawners.map((f) => f.split('/').pop())).toEqual(['git-write.ts']);
});

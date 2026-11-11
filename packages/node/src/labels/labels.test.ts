import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeApp } from '../app.js';
import { openControlState } from '../control/state.js';
import { createNode } from '../runtime.js';
import { setupControl } from '../control/test-support.js';
import type { NodeRuntime } from '../runtime.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
const label = (
  a: ReturnType<typeof createNodeApp>,
  boot: string,
  text: string,
) =>
  a.request('/projects/project/sessions/session/label', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-c9view-boot-id': boot },
    body: JSON.stringify({ clientRequestId: randomUUID(), label: text }),
  });

it('T078 sets, replaces and removes a label through receipts', async () => {
  const t = await setupControl();
  cleanups.push(t.close);
  const a = createNodeApp({
    store: t.store,
    control: t.service,
    controlConfig: t.config,
  } as unknown as NodeRuntime);
  expect((await label(a, t.bootId, '  My label ')).status).toBe(200);
  expect(await (await a.request('/labels')).json()).toEqual({
    labels: [{ projectId: 'project', sessionId: 'session', label: 'My label' }],
  });
  expect((await label(a, t.bootId, '')).status).toBe(200);
  expect(await (await a.request('/labels')).json()).toEqual({ labels: [] });
  expect((await label(a, t.bootId, 'x'.repeat(81))).status).toBe(400);
  expect((await label(a, t.bootId, 'bad\nlabel')).status).toBe(400);
  const missing = await a.request('/projects/project/sessions/other/label', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-c9view-boot-id': t.bootId,
    },
    body: JSON.stringify({ clientRequestId: randomUUID(), label: 'x' }),
  });
  expect(missing.status).toBe(404);
});
it('T078 a label survives a restart and writes only under c9view/', async () => {
  const t = await setupControl();
  cleanups.push(t.close);
  const before = await readdir(t.claudeDir);
  await t.service.label(
    'project',
    'session',
    { clientRequestId: randomUUID(), label: 'kept' },
    t.bootId,
  );
  expect(await readdir(t.claudeDir)).toEqual(before);
  expect(before).toEqual(['c9view']);
  // The rebuildable index lives elsewhere; the label lives in the node state db.
  await rm(t.store.config.dbPath, { force: true });
  await t.service.close();
  const state = openControlState(join(t.claudeDir, 'c9view'));
  expect(state.labels()).toEqual([
    { projectId: 'project', sessionId: 'session', label: 'kept' },
  ]);
  state.close();
});
it('T078 label routes answer 404 with control off', async () => {
  const runtime = createNode(
    {
      claudeDir: '/nonexistent/synthetic',
      dbPath: '/tmp/unused-index',
      workspaceRoots: [],
    },
    { control: false, bypass: false },
  );
  cleanups.push(() => runtime.close());
  const a = createNodeApp(runtime);
  expect((await a.request('/labels')).status).toBe(404);
  expect((await label(a, randomUUID(), 'x')).status).toBe(404);
});
it('rejects Unicode control and format characters in labels', async () => {
  const t = await setupControl();
  cleanups.push(t.close);
  const a = createNodeApp({
    store: t.store,
    control: t.service,
    controlConfig: t.config,
  } as unknown as NodeRuntime);
  for (const bad of ['a‮b', 'a​b', 'a b', 'a\u0085b'])
    expect((await label(a, t.bootId, bad)).status).toBe(400);
});

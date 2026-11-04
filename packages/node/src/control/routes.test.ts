import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { controlRoutes } from './routes.js';
import { createNode } from '../runtime.js';
import { createNodeApp } from '../app.js';
import { setupControl } from './test-support.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const paths = [
  '/control/runs',
  '/control/receipts/id',
  '/projects/project/sessions/session/messages',
  '/projects/project/sessions',
  '/control/requests/id',
  '/control/runs/id/interrupt',
  '/control/runs/id/stop',
  '/control/runs/id/mode',
  '/projects/trust',
];
it('T013 control off mounts no actions and never imports the SDK module', async () => {
  const sdk = vi.fn(() => {
    throw new Error('SDK must remain unloaded');
  });
  vi.doMock('./sdk.js', sdk);
  const runtime = createNode(
    {
      claudeDir: '/nonexistent/synthetic',
      dbPath: '/tmp/unused-index',
      workspaceRoots: [],
    },
    { control: false, bypass: false },
  );
  cleanups.push(() => runtime.close());
  const app = createNodeApp(runtime);
  for (const path of paths) {
    expect(
      (
        await app.request(path, {
          method:
            (path.startsWith('/control/runs') &&
              !path.endsWith('/mode') &&
              !path.endsWith('/stop') &&
              !path.endsWith('/interrupt')) ||
            path.startsWith('/control/receipts')
              ? 'GET'
              : 'POST',
        })
      ).status,
    ).toBe(404);
  }
  expect(runtime.hello.capabilities.control.state).toBe('off');
  expect(runtime.control).toBeUndefined();
  expect(sdk).not.toHaveBeenCalled();
  vi.doUnmock('./sdk.js');
});
it('T012 T021 T029 T037 routes validate boot, body sizes and modes and recover accepted receipt', async () => {
  const t = await setupControl();
  cleanups.push(t.close);
  const app = new Hono().route('/', controlRoutes(t.service));
  const post = (
    path: string,
    body: unknown,
    boot: string | undefined = t.bootId,
  ) =>
    app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(boot ? { 'x-c9view-boot-id': boot } : {}),
      },
      body: JSON.stringify(body),
    });
  expect((await post('/projects/project/sessions', t.body(), '')).status).toBe(
    403,
  );
  expect(
    (
      await post('/projects/project/sessions', {
        ...t.body(),
        text: 'x'.repeat(50000),
      })
    ).status,
  ).toBe(413);
  expect(
    (
      await post('/projects/project/sessions', {
        ...t.body(),
        permissionMode: 'bypassPermissions',
      })
    ).status,
  ).toBe(400);
  expect(
    (await post('/projects/project/sessions', { ...t.body(), text: '' }))
      .status,
  ).toBe(400);
  const body = t.body();
  const response = await post('/projects/project/sessions', body);
  expect(response.status).toBe(202);
  const receipt = await response.json();
  expect(await (await post('/projects/project/sessions', body)).json()).toEqual(
    receipt,
  );
  expect(
    await (
      await app.request(`/control/receipts/${body.clientRequestId}`)
    ).json(),
  ).toEqual(receipt);
  expect((await app.request(`/control/receipts/${randomUUID()}`)).status).toBe(
    404,
  );
});

it.each([
  ['reply', { permissionMode: 'auto' }],
  ['reply', { permissionMode: 'dontAsk' }],
  ['reply', { permissionMode: 'bypassPermissions' }],
  ['reply', { permissionMode: 42 }],
  ['reply', { name: 42 }],
  ['start', { permissionMode: 'auto' }],
  ['start', { name: 42 }],
  ['start', { unexpected: true }],
] as const)(
  'rejects unvalidated %s fields %j before the SDK',
  async (kind, extra) => {
    const t = await setupControl();
    cleanups.push(t.close);
    const app = controlRoutes(t.service);
    const path =
      kind === 'reply'
        ? '/projects/project/sessions/session/messages'
        : '/projects/project/sessions';
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'x-c9view-boot-id': t.bootId },
      body: JSON.stringify({ ...t.body(), ...extra }),
    });
    expect(response.status).toBe(400);
    expect(t.service.snapshot().runs).toEqual([]);
    expect(t.sdk.runs).toEqual([]);
  },
);

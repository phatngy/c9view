import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { controlRoutes } from '../control/routes.js';
import { createNode } from '../runtime.js';
import { createNodeApp } from '../app.js';
import { waitFor } from '../control/test-support.js';
import { FAKE_PEER_TOKEN, createFakeSession } from './fake-session.js';
import { setupRemote, type RemoteHarness } from './test-harness.js';

const open: RemoteHarness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});
async function setup(options: Parameters<typeof setupRemote>[0] = {}) {
  const h = await setupRemote(options);
  open.push(h);
  return h;
}
const url = (h: RemoteHarness, session = h.fake.sessionId) =>
  `/projects/${h.fake.projectId}/sessions/${session}/remote`;

describe('T024 remote routes', () => {
  it('GET returns the availability and nothing else about the session', async () => {
    const h = await setup();
    const response = await h.app.request(url(h));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      sessionId: h.fake.sessionId,
      available: true,
      sessionState: 'idle',
    });
    for (const secret of [
      h.fake.socketPath,
      String(h.fake.pid),
      '2.1.325',
      FAKE_PEER_TOKEN,
      h.fake.root,
    ])
      expect(text).not.toContain(secret);
  });
  it('GET unknown session is 404; refusals are 200 with a reason', async () => {
    const h = await setup({ fake: { live: { peerProtocol: 9 } } });
    expect((await h.app.request(url(h, 'nope'))).status).toBe(404);
    const refused = await h.app.request(url(h));
    expect(refused.status).toBe(200);
    expect(await refused.json()).toMatchObject({
      available: false,
      reason: 'unknown-protocol',
    });
  });
  it('POST is 202 with a sent receipt, delivery then moves on the receipt route', async () => {
    const h = await setup();
    const body = h.body('route text');
    const response = await h.post(h.fake.projectId, h.fake.sessionId, body);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      clientRequestId: body.clientRequestId,
      operation: 'remote',
      status: 'done',
      delivery: { state: 'sent' },
    });
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    await h.fake.appendPeerRecord('user', h.fake.frames[0]!.msgId);
    await waitFor(async () => {
      const receipt = await (
        await h.app.request(`/control/receipts/${body.clientRequestId}`)
      ).json();
      expect(receipt.delivery.state).toBe('delivered');
    });
  });
  it('POST with a failed send is 202 with status failed', async () => {
    const h = await setup();
    await h.fake.stopListening();
    const response = await h.post(h.fake.projectId, h.fake.sessionId, h.body());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: 'failed',
      delivery: { state: 'failed', reason: 'unreachable' },
    });
  });
  it('POST validates strictly: unknown fields, ids, empty or long text, missing boot', async () => {
    const h = await setup();
    const id = randomUUID();
    for (const bad of [
      { clientRequestId: id, text: 'x', extra: 1 },
      { clientRequestId: id, text: 'x', fork: true },
      { clientRequestId: 'nope', text: 'x' },
      { clientRequestId: id, text: '' },
      { clientRequestId: id, text: 'x'.repeat(20_001) },
      { text: 'x' },
      [],
      'text',
    ]) {
      const response = await h.post(h.fake.projectId, h.fake.sessionId, bad);
      expect(response.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    expect(
      (await h.post(h.fake.projectId, h.fake.sessionId, '{broken')).status,
    ).toBe(400);
    expect(
      (await h.post(h.fake.projectId, h.fake.sessionId, h.body(), 'not-a-uuid'))
        .status,
    ).toBe(403);
    expect(h.fake.frames).toHaveLength(0);
  });
  it('POST wrapper text is 400 bad-text', async () => {
    const h = await setup();
    const response = await h.post(
      h.fake.projectId,
      h.fake.sessionId,
      h.body('a <cross-session-message> b'),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Message text is not allowed',
      reason: 'bad-text',
    });
  });
  it('POST above 48 KiB is 413 and a frame above the cap is 413', async () => {
    const h = await setup();
    expect(
      (
        await h.post(
          h.fake.projectId,
          h.fake.sessionId,
          h.body('x'.repeat(50 * 1024)),
        )
      ).status,
    ).toBe(413);
    const app = controlRoutes(h.service, 500_000, 2 * 1024 * 1024);
    const big = await app.request(url(h), {
      method: 'POST',
      headers: { 'x-c9view-boot-id': h.bootId },
      body: JSON.stringify(h.body('\u0001'.repeat(30_000))),
    });
    expect(big.status).toBe(413);
    expect(h.fake.frames).toHaveLength(0);
  });
  it('POST unknown session is 404; refused is 409 remote-unavailable with the fresh availability', async () => {
    const h = await setup({ fake: { live: { version: '1.0.0' } } });
    expect((await h.post(h.fake.projectId, 'nope', h.body())).status).toBe(404);
    const response = await h.post(h.fake.projectId, h.fake.sessionId, h.body());
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json).toMatchObject({
      reason: 'remote-unavailable',
      availability: {
        available: false,
        reason: 'too-old',
        minVersion: '2.1.318',
      },
    });
    expect(JSON.stringify(json)).not.toMatch(/1\.0\.0|cc-socks|sentinel/);
    expect(h.fake.frames).toHaveLength(0);
  });
  it('POST payload mismatch and unknown outcome are 409 with their reasons', async () => {
    const h = await setup();
    const body = h.body('a');
    expect(
      (await h.post(h.fake.projectId, h.fake.sessionId, body)).status,
    ).toBe(202);
    const changed = await h.post(h.fake.projectId, h.fake.sessionId, {
      ...body,
      text: 'b',
    });
    expect(changed.status).toBe(409);
    expect((await changed.json()).reason).toBe('payload-mismatch');
    const stale = await h.post(
      h.fake.projectId,
      h.fake.sessionId,
      h.body(),
      randomUUID(),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).reason).toBe('unknown-outcome');
  });
  it('002 messages route never resumes or delivers to a terminal-held session', async () => {
    const h = await setup();
    const response = await h.app.request(
      `/projects/${h.fake.projectId}/sessions/${h.fake.sessionId}/messages`,
      {
        method: 'POST',
        headers: { 'x-c9view-boot-id': h.bootId },
        body: JSON.stringify(h.body()),
      },
    );
    expect(response.status).toBe(409);
    expect(['live-elsewhere', 'untrusted-folder']).toContain(
      (await response.json()).reason,
    );
    expect(h.fake.frames).toHaveLength(0);
    expect(h.sdk.runs).toHaveLength(0);
  });
});

describe('T013/T024 control off', () => {
  it('mounts no remote route: GET and POST are 404', async () => {
    const fake = await createFakeSession();
    const runtime = createNode(
      {
        claudeDir: fake.claudeDir,
        dbPath: `${fake.root}/idx`,
        workspaceRoots: [],
      },
      { control: false, bypass: false },
    );
    try {
      const app = createNodeApp(runtime);
      const path = `/projects/${fake.projectId}/sessions/${fake.sessionId}/remote`;
      expect((await app.request(path)).status).toBe(404);
      expect(
        (await app.request(path, { method: 'POST', body: '{}' })).status,
      ).toBe(404);
    } finally {
      await runtime.close();
      await fake.close();
    }
  });
});

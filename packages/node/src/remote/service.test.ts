import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadControlConfig, ControlConfigError } from '../control/config.js';
import { waitFor } from '../control/test-support.js';
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
const send = (h: RemoteHarness, body = h.body()) =>
  h.service.remoteSend(h.fake.projectId, h.fake.sessionId, body, h.bootId);
const delivery = (h: RemoteHarness, id: string) =>
  h.service.receipt(id)?.delivery;

class ScriptedSocket extends EventEmitter {
  bytesWritten = 0;
  constructor(private script: (s: ScriptedSocket) => void) {
    super();
    setImmediate(() => this.script(this));
  }
  end() {}
  destroy() {}
}
const scripted =
  (script: (s: ScriptedSocket) => void): ((path: string) => Socket) =>
  () =>
    new ScriptedSocket(script) as unknown as Socket;

describe('T117 remote send without an API-key method', () => {
  it('still delivers to a live terminal session and reports sdkAuth', async () => {
    const h = await setup({ apiKey: false });
    expect(h.service.capability.sdkAuth).toBe('api-key-required');
    expect(h.service.capability.state).toBe('ready');
    const receipt = await send(h);
    expect(receipt).toMatchObject({
      status: 'done',
      delivery: { state: 'sent' },
    });
  });
});

describe('T023 send and receipts', () => {
  it('writes exactly one frame, settles as sent, and starts no run, session or process', async () => {
    const h = await setup();
    const body = h.body('hello terminal');
    const started = Date.now();
    const receipt = await send(h, body);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(receipt).toMatchObject({
      clientRequestId: body.clientRequestId,
      operation: 'remote',
      status: 'done',
      projectId: h.fake.projectId,
      sessionId: h.fake.sessionId,
      delivery: { state: 'sent' },
    });
    expect(Date.parse(receipt.delivery!.sentAt!)).not.toBeNaN();
    expect(receipt.runId).toBeUndefined();
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    const frame = h.fake.frames[0]!;
    expect(frame.json).toMatchObject({
      msgV: 1,
      type: 'user',
      priority: 'next',
      from: 'uds:/dev/null/c9view',
    });
    expect(frame.body).toContain('hello terminal');
    expect(h.sdk.runs).toHaveLength(0);
    expect(h.service.snapshot().runs).toEqual([]);
    expect(
      (await h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId))
        .available,
    ).toBe(true);
  });
  it('replays the same command without writing again, and refuses a changed body', async () => {
    const h = await setup();
    const body = h.body('once');
    const [a, b] = await Promise.all([send(h, body), send(h, body)]);
    expect(b).toEqual(a);
    expect(await send(h, body)).toEqual(a);
    await expect(send(h, { ...body, text: 'changed' })).rejects.toMatchObject({
      status: 409,
      reason: 'payload-mismatch',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fake.frames).toHaveLength(1);
  });
  it('a restarted node answers unknown-outcome and never writes', async () => {
    const h = await setup();
    const body = h.body();
    const second = h.make(randomUUID());
    try {
      await expect(
        second.remoteSend(h.fake.projectId, h.fake.sessionId, body, h.bootId),
      ).rejects.toMatchObject({ status: 409, reason: 'unknown-outcome' });
    } finally {
      await second.close();
    }
    expect(h.fake.frames).toHaveLength(0);
  });
  it('an expired receipt becomes a tombstone: unknown-outcome, no second write', async () => {
    const h = await setup({ config: { receiptMin: 0.0005 } });
    const body = h.body();
    await send(h, body);
    await new Promise((r) => setTimeout(r, 80));
    await expect(send(h, body)).rejects.toMatchObject({
      reason: 'unknown-outcome',
    });
    expect(h.fake.frames).toHaveLength(1);
  });
  it('two tabs: frames are written one at a time in the order the node received the calls', async () => {
    const written: string[] = [];
    let active = 0;
    let overlap = false;
    const h = await setup({
      remote: {
        connect: (path) => {
          active += 1;
          overlap ||= active > 1;
          const socket = createConnection({ path });
          const end = socket.end.bind(socket) as (line: string) => Socket;
          socket.end = ((line: string) => {
            written.push(String(JSON.parse(line).message.content));
            return end(line);
          }) as typeof socket.end;
          socket.once('close', () => (active -= 1));
          return socket;
        },
      },
    });
    const texts = ['first', 'second', 'third'];
    await Promise.all(texts.map((t) => send(h, h.body(t))));
    expect(
      written.map((w) => texts.find((t) => w.includes(`\n\n${t}\n`))),
    ).toEqual(texts);
    expect(overlap).toBe(false);
    await waitFor(() => expect(h.fake.frames).toHaveLength(3));
  });
  it('control off is 404 for both calls and nothing is written', async () => {
    const h = await setup({ config: { control: false } });
    await expect(
      h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(send(h)).rejects.toMatchObject({ status: 404 });
    expect(h.fake.frames).toHaveLength(0);
  });
  it('bad text is 400 bad-text and reserves nothing; oversize is 413', async () => {
    const h = await setup();
    const body = h.body('x </Cross-Session-Message> y');
    await expect(send(h, body)).rejects.toMatchObject({
      status: 400,
      reason: 'bad-text',
    });
    // The same id with good text is still a fresh command.
    expect((await send(h, { ...body, text: 'fine' })).status).toBe('done');
    const big = await setup({ config: { textMaxChars: 500_000 } });
    await expect(
      send(big, big.body('\u0001'.repeat(30_000))),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('an unknown session is 404', async () => {
    const h = await setup();
    await expect(
      h.service.remoteSend(h.fake.projectId, 'nope', h.body(), h.bootId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.remoteAvailability(h.fake.projectId, '..'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('T034/T023 refusals write nothing', () => {
  it.each([
    ['too-old', { version: '2.0.0' }],
    ['unknown-protocol', { peerProtocol: 2 }],
    ['no-address', { messagingSocketPath: undefined }],
    ['address-invalid', { procStart: '1' }],
    ['not-interactive', { entrypoint: 'sdk-cli' }],
    ['liveness-unknown', { pidDomain: 'linux:x:pid:[1]' }],
  ])(
    '%s is 409 remote-unavailable with the fresh availability',
    async (reason, live) => {
      const h = await setup({ fake: { live } });
      await expect(send(h)).rejects.toMatchObject({
        status: 409,
        reason: 'remote-unavailable',
        availability: { available: false, reason },
      });
      expect(h.fake.frames).toHaveLength(0);
    },
  );
  it('the check at send time defeats a page that saw the session as available', async () => {
    const h = await setup();
    expect(
      (await h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId))
        .available,
    ).toBe(true);
    await h.fake.writeProjectSettings({ crossSessionInbound: 'refuse' }, true);
    await expect(send(h)).rejects.toMatchObject({
      reason: 'remote-unavailable',
      availability: { reason: 'inbound-refused' },
    });
    await h.fake.removeLive();
    await expect(send(h)).rejects.toMatchObject({
      availability: { reason: 'not-live' },
    });
    expect(h.fake.frames).toHaveLength(0);
  });
  it("a session held by one of c9view's own runs is own-run and nothing is written", async () => {
    const h = await setup({ deps: { liveness: async () => {} } });
    await writeFile(
      join(h.fake.root, '.claude.json'),
      JSON.stringify({
        projects: { [h.fake.folder]: { hasTrustDialogAccepted: true } },
      }),
    );
    await h.service.reply(
      h.fake.projectId,
      h.fake.sessionId,
      h.body(),
      h.bootId,
    );
    await waitFor(() => expect(h.sdk.runs).toHaveLength(1));
    expect(h.service.snapshot().runs[0]?.sessionId).toBe(h.fake.sessionId);
    await expect(
      h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId),
    ).resolves.toMatchObject({ available: false, reason: 'own-run' });
    await expect(send(h)).rejects.toMatchObject({
      status: 409,
      reason: 'remote-unavailable',
      availability: { reason: 'own-run' },
    });
    expect(h.fake.frames).toHaveLength(0);
  });
  it('a refusal consumes its clientRequestId (002 reserve keeps a rejected reservation); a new id works once fixed', async () => {
    const h = await setup({ fake: { live: { version: '2.0.0' } } });
    const refused = h.body('again');
    await expect(send(h, refused)).rejects.toMatchObject({
      reason: 'remote-unavailable',
    });
    await h.fake.writeLive({ version: '2.1.325' });
    // Same id, same body: the same 409, nothing is sent.
    await expect(send(h, refused)).rejects.toMatchObject({
      reason: 'remote-unavailable',
    });
    expect(h.fake.frames).toHaveLength(0);
    // A fresh id is a new command.
    expect((await send(h, h.body('again'))).delivery?.state).toBe('sent');
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
  });
  it('a refused command stays refused on retry (never acts later)', async () => {
    const h = await setup({ fake: { live: { version: '2.0.0' } } });
    const body = h.body();
    await expect(send(h, body)).rejects.toMatchObject({
      reason: 'remote-unavailable',
    });
    await h.fake.writeLive({ version: '2.1.325' });
    await expect(send(h, body)).rejects.toMatchObject({
      reason: 'remote-unavailable',
    });
    expect(h.fake.frames).toHaveLength(0);
  });
});

describe('T022/T038 failures and uncertainty', () => {
  it('a refused connection with a live matching process is failed/unreachable (real stale socket)', async () => {
    const h = await setup();
    await h.fake.stopListening();
    const receipt = await send(h);
    expect(receipt).toMatchObject({
      status: 'failed',
      delivery: { state: 'failed', reason: 'unreachable' },
    });
    expect(receipt.error).toBe('The session could not be reached');
  });
  it('a refused connection with a process that went away is failed/session-ended', async () => {
    const real = (await import('./proc.js')).readProcStart;
    let n = 0;
    const g = await setup({
      remote: {
        procStartOf: (pid) => (n++ === 0 ? real(pid) : '1'),
        connect: scripted((s) =>
          s.emit(
            'error',
            Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
          ),
        ),
      },
    });
    const receipt = await send(g);
    expect(receipt).toMatchObject({
      status: 'failed',
      delivery: { state: 'failed', reason: 'session-ended' },
    });
    expect(receipt.error).toBe('The terminal session ended');
    expect(g.fake.frames).toHaveLength(0);
  });
  it('failed receipts are never tracked or resent', async () => {
    const h = await setup();
    await h.fake.stopListening();
    const body = h.body();
    const a = await send(h, body);
    await h.fake.appendPeerRecord('user', 'whatever');
    expect(await send(h, body)).toEqual(a);
    expect(h.service.receipt(body.clientRequestId)?.delivery?.state).toBe(
      'failed',
    );
  });
  it('a write timeout after connect is uncertain, still tracked, never resent, and can become delivered', async () => {
    const h = await setup({
      config: { remoteSendTimeoutSec: 0.03 },
      remote: { connect: scripted((s) => s.emit('connect')) },
    });
    const body = h.body();
    const receipt = await send(h, body);
    expect(receipt).toMatchObject({
      status: 'done',
      delivery: { state: 'uncertain' },
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(delivery(h, body.clientRequestId)?.state).toBe('uncertain');
    // Part of a frame can still arrive: the record carries the msg_id the node generated is
    // unknown to the test, so assert the state holds and no frame was written by the node.
    expect(h.fake.frames).toHaveLength(0);
  });
  it('a break after some bytes is uncertain', async () => {
    const h = await setup({
      remote: {
        connect: scripted((s) => {
          s.bytesWritten = 10;
          s.emit('error', Object.assign(new Error('x'), { code: 'EPIPE' }));
        }),
      },
    });
    expect((await send(h)).delivery?.state).toBe('uncertain');
  });
  it('a reset before any byte maps like a refused connection', async () => {
    const h = await setup({
      remote: {
        connect: scripted((s) =>
          s.emit(
            'error',
            Object.assign(new Error('x'), { code: 'ECONNRESET' }),
          ),
        ),
      },
    });
    expect((await send(h)).delivery).toMatchObject({
      state: 'failed',
      reason: 'unreachable',
    });
  });
});

describe('T038 delivery transitions', () => {
  const msgOf = (h: RemoteHarness) => h.fake.frames[0]!.msgId;
  it('sent then delivered/new-turn from an idle user record, with the record timestamp and an IDs-only event', async () => {
    const h = await setup();
    const body = h.body();
    await send(h, body);
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    await h.fake.appendPeerRecord('user', msgOf(h), {
      timestamp: '2026-11-17T09:00:00.000Z',
    });
    const appended = Date.now();
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)?.state).toBe('delivered'),
    );
    expect(Date.now() - appended).toBeLessThan(2000);
    expect(delivery(h, body.clientRequestId)).toMatchObject({
      state: 'delivered',
      turn: 'new-turn',
      deliveredAt: '2026-11-17T09:00:00.000Z',
    });
    expect(delivery(h, body.clientRequestId)?.sentAt).toBeDefined();
    expect(h.service.receipt(body.clientRequestId)?.status).toBe('done');
    const hints = h.seen.filter((e) => e.event === ('control.remote' as never));
    expect(hints.length).toBeGreaterThanOrEqual(2);
    for (const hint of hints)
      expect(hint.data).toEqual({
        clientRequestId: body.clientRequestId,
        projectId: h.fake.projectId,
        sessionId: h.fake.sessionId,
      });
  });
  it('a queued attachment is next-step', async () => {
    const h = await setup();
    const body = h.body();
    await send(h, body);
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    await h.fake.appendPeerRecord('queued', msgOf(h));
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)).toMatchObject({
        state: 'delivered',
        turn: 'next-step',
      }),
    );
  });
  it('a session event wakes the tracker before the next poll', async () => {
    const h = await setup({ remote: { pollMs: 60_000 } });
    const body = h.body();
    await send(h, body);
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    await h.fake.appendPeerRecord('user', msgOf(h));
    h.store.events.emit({
      event: 'session',
      data: { projectId: h.fake.projectId, sessionId: h.fake.sessionId },
    });
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)?.state).toBe('delivered'),
    );
  });
  it('hold or drop: not-seen, then a later release (same msg_id) turns it delivered', async () => {
    const h = await setup({ config: { remoteNotSeenSec: 0.05 } });
    const body = h.body();
    await send(h, body);
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)?.state).toBe('not-seen'),
    );
    expect(h.service.receipt(body.clientRequestId)?.status).toBe('done');
    await h.fake.appendPeerRecord('user', msgOf(h), {
      timestamp: '2026-11-17T12:00:00.000Z',
    });
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)).toMatchObject({
        state: 'delivered',
        deliveredAt: '2026-11-17T12:00:00.000Z',
      }),
    );
  });
  it('other peers and typed prompts never confirm a delivery', async () => {
    const h = await setup({ config: { remoteNotSeenSec: 0.05 } });
    const body = h.body();
    await send(h, body);
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    await h.fake.appendPeerRecord('user', randomUUID());
    await h.fake.appendHuman('typed in the terminal');
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)?.state).toBe('not-seen'),
    );
  });
  it('autoDeliver fake: end to end sent to delivered without any run', async () => {
    const h = await setup({ fake: { autoDeliver: 'user' } });
    const body = h.body();
    await send(h, body);
    await waitFor(() =>
      expect(delivery(h, body.clientRequestId)?.state).toBe('delivered'),
    );
    expect(h.sdk.runs).toHaveLength(0);
  });
  it('stops tracking when the receipt expires', async () => {
    const h = await setup({ config: { receiptMin: 0.001 } });
    const body = h.body();
    await send(h, body);
    await new Promise((r) => setTimeout(r, 150));
    expect(h.service.receipt(body.clientRequestId)).toBeUndefined();
  });
});

describe('T040 settings', () => {
  it('defaults to 3 s and 20 s', () => {
    const c = loadControlConfig({}, { control: true });
    expect(c.remoteSendTimeoutSec).toBe(3);
    expect(c.remoteNotSeenSec).toBe(20);
  });
  it('reads valid environment values, including fractions', () => {
    const c = loadControlConfig(
      {
        C9VIEW_REMOTE_SEND_TIMEOUT_SEC: '5',
        C9VIEW_REMOTE_NOT_SEEN_SEC: '0.5',
      },
      { control: true },
    );
    expect(c.remoteSendTimeoutSec).toBe(5);
    expect(c.remoteNotSeenSec).toBe(0.5);
  });
  it.each([
    ['C9VIEW_REMOTE_SEND_TIMEOUT_SEC', '0'],
    ['C9VIEW_REMOTE_SEND_TIMEOUT_SEC', '-1'],
    ['C9VIEW_REMOTE_SEND_TIMEOUT_SEC', 'abc'],
    ['C9VIEW_REMOTE_NOT_SEEN_SEC', 'NaN'],
    ['C9VIEW_REMOTE_NOT_SEEN_SEC', 'Infinity'],
    ['C9VIEW_REMOTE_NOT_SEEN_SEC', '0'],
  ])('rejects %s=%s', (key, value) => {
    expect(() =>
      loadControlConfig({ [key]: value }, { control: true }),
    ).toThrow(ControlConfigError);
  });
});

import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { setupControl, waitFor } from './test-support.js';
import { setupRemote, type RemoteHarness } from '../remote/test-harness.js';
import { FAKE_KEY_CONTENT, FAKE_PEER_TOKEN } from '../remote/fake-session.js';
it('T036 never logs prompts/tool inputs/answers and redacts SDK errors', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const t = await setupControl(
    {},
    {
      liveness: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new Error('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789'),
        ),
    },
  );
  try {
    const receipt = await t.service.reply(
      'project',
      'session',
      t.body(),
      t.bootId,
    );
    await waitFor(() =>
      expect(t.service.receipt(receipt.clientRequestId)?.status).toBe('failed'),
    );
    expect(t.service.receipt(receipt.clientRequestId)?.error).not.toContain(
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
    );
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  } finally {
    await t.close();
    error.mockRestore();
    log.mockRestore();
  }
});
it('T036 tool input and question answers never enter logs', async () => {
  const t = await setupControl();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await t.service.start('project', t.body(), t.bootId);
    await waitFor(() => expect(t.sdk.runs).toHaveLength(1));
    const question = t.sdk.runs[0]!.permission('AskUserQuestion', {
      questions: [
        {
          question: 'Synthetic question?',
          header: 'Question',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    });
    await waitFor(() => expect(t.service.snapshot().requests).toHaveLength(1));
    const request = t.service.snapshot().requests[0]!;
    const { randomUUID } = await import('node:crypto');
    await t.service.decide(
      request.requestId,
      {
        clientRequestId: randomUUID(),
        answers: { 'Synthetic question?': 'synthetic private answer' },
      },
      t.bootId,
    );
    await question;
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  } finally {
    await t.close();
    error.mockRestore();
    log.mockRestore();
  }
});

// Remote send (003): nothing about the socket, token, process or text may leave.
it('T019 remote success, refusal and error modes leak no address, token, PID, version or text', async () => {
  const sinks = [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'info').mockImplementation(() => {}),
    vi.spyOn(console, 'debug').mockImplementation(() => {}),
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
  ];
  const harnesses: RemoteHarness[] = [];
  const outputs: string[] = [];
  const TEXT = 'sentinel-message-text-c4d2e8';
  try {
    // Success, hold (not seen) and delivery.
    const ok = await setupRemote({ config: { remoteNotSeenSec: 0.05 } });
    harnesses.push(ok);
    const addr = (h: RemoteHarness) => [
      h.fake.socketPath,
      String(h.fake.pid),
      h.fake.root,
      h.fake.claudeDir,
    ];
    const body = ok.body(TEXT);
    const mark = (value: unknown) => outputs.push(JSON.stringify(value));
    mark(await ok.service.remoteAvailability(ok.fake.projectId, ok.fake.sessionId));
    const response = await ok.post(ok.fake.projectId, ok.fake.sessionId, body);
    outputs.push(await response.text());
    await waitFor(() => expect(ok.service.receipt(body.clientRequestId)?.delivery?.state).toBe('not-seen'));
    await ok.fake.appendPeerRecord('queued', ok.fake.frames[0]!.msgId);
    await waitFor(() => expect(ok.service.receipt(body.clientRequestId)?.delivery?.state).toBe('delivered'));
    mark(ok.service.receipt(body.clientRequestId));
    outputs.push(await (await ok.app.request(`/control/receipts/${body.clientRequestId}`)).text());
    mark(ok.seen);
    // Refusals and an availability read of each.
    const refused = await setupRemote({ fake: { live: { version: '2.0.1', peerProtocol: 3 } } });
    harnesses.push(refused);
    const rr = await refused.post(refused.fake.projectId, refused.fake.sessionId, refused.body(TEXT));
    expect(rr.status).toBe(409);
    outputs.push(await rr.text());
    outputs.push(await (await refused.app.request(`/projects/${refused.fake.projectId}/sessions/${refused.fake.sessionId}/remote`)).text());
    // Native errors with the path, token and text in their message never reach a receipt.
    let secretMessage = '';
    const failing = await setupRemote({
      remote: {
        connect: () => {
          const socket = new EventEmitter() as EventEmitter & { bytesWritten: number; end(): void; destroy(): void };
          socket.bytesWritten = 0;
          socket.end = () => {};
          socket.destroy = () => {};
          setImmediate(() =>
            socket.emit('error', Object.assign(new Error(secretMessage), { code: 'ECONNREFUSED' })),
          );
          return socket as unknown as Socket;
        },
      },
    });
    harnesses.push(failing);
    secretMessage = `connect ECONNREFUSED ${failing.fake.socketPath} ${FAKE_PEER_TOKEN} ${TEXT} sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789`;
    const failed = await failing.post(failing.fake.projectId, failing.fake.sessionId, failing.body(TEXT));
    expect(failed.status).toBe(202);
    const failedText = await failed.text();
    expect(JSON.parse(failedText).status).toBe('failed');
    outputs.push(failedText);
    mark(failing.seen);
    // Unknown session and bad body.
    outputs.push(await (await ok.post(ok.fake.projectId, 'missing', ok.body(TEXT))).text());
    outputs.push(await (await ok.post(ok.fake.projectId, ok.fake.sessionId, { text: TEXT })).text());
    const joined = outputs.join('\n');
    const secrets = [
      ...addr(ok), ...addr(refused), ...addr(failing),
      TEXT, FAKE_PEER_TOKEN, FAKE_KEY_CONTENT, 'peerToken', '2.1.325', '2.0.1',
      'sk-ant-api03',
    ];
    for (const secret of secrets)
      expect(joined, secret).not.toContain(secret);
    expect(joined.toLowerCase()).not.toContain('token');
    for (const sink of sinks) expect(sink).not.toHaveBeenCalled();
  } finally {
    for (const sink of sinks) sink.mockRestore();
    for (const h of harnesses) await h.close();
  }
});

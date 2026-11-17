import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupControl, waitFor } from './test-support.js';
import { setupRemote, type RemoteHarness } from '../remote/test-harness.js';
import { FAKE_KEY_CONTENT, FAKE_PEER_TOKEN } from '../remote/fake-session.js';

const opened: string[] = [];
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      opened.push(String(args[0]));
      return actual.readFile(...args);
    }) as typeof actual.readFile,
    open: ((...args: Parameters<typeof actual.open>) => {
      opened.push(String(args[0]));
      return actual.open(...args);
    }) as typeof actual.open,
  };
});
async function tree(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isDirectory())
    return [info.mtimeMs, (await readFile(path)).toString('hex')];
  const entries = await readdir(path);
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((name) => name !== 'c9view')
        .map(async (name) => [name, await tree(join(path, name))]),
    ),
  );
}
it('T035 all control operations leave Claude data and project files unchanged', async () => {
  const t = await setupControl();
  try {
    const before = await tree(t.root);
    const { FolderTrust } = await import('./trust.js');
    const trust = await new FolderTrust(t.claudeDir, {
      trusted: () => false,
      trust: () => {},
      close: () => {},
    }).summary(t.folder);
    await t.service.trust(
      {
        clientRequestId: randomUUID(),
        path: t.folder,
        fingerprint: trust.fingerprint,
      },
      t.bootId,
    );
    const receipt = await t.service.reply(
      'project',
      'session',
      t.body(),
      t.bootId,
    );
    await waitFor(() => expect(t.sdk.runs).toHaveLength(1));
    const run = t.sdk.runs[0]!;
    run.init('session');
    await waitFor(() =>
      expect(t.service.snapshot().runs[0]?.state).toBe('running'),
    );
    const permission = run.permission('Read', { path: 'synthetic.txt' });
    await waitFor(() => expect(t.service.snapshot().requests).toHaveLength(1));
    await t.service.decide(
      t.service.snapshot().requests[0]!.requestId,
      {
        clientRequestId: randomUUID(),
        decision: 'deny',
        message: 'synthetic answer',
      },
      t.bootId,
    );
    await permission;
    await t.service.setMode(
      receipt.runId!,
      { clientRequestId: randomUUID(), mode: 'plan' },
      t.bootId,
    );
    await t.service.interrupt(
      receipt.runId!,
      { clientRequestId: randomUUID() },
      t.bootId,
    );
    await t.service.stop(
      receipt.runId!,
      { clientRequestId: randomUUID() },
      t.bootId,
    );
    await t.service.start('project', t.body(), t.bootId);
    await waitFor(() => expect(t.sdk.runs).toHaveLength(2));
    t.service.snapshot();
    t.service.receipt(receipt.clientRequestId);
    await t.service.close();
    expect(await tree(t.root)).toEqual(before);
  } finally {
    await t.close();
  }
});
it('T035 rejects state paths whose symlinked ancestors point into a project', async () => {
  const t = await setupControl();
  try {
    const { symlink } = await import('node:fs/promises');
    const { assertStateLocation } = await import('./trust.js');
    await symlink(t.folder, join(t.root, 'alias'));
    expect(() =>
      assertStateLocation(join(t.root, 'alias/state'), t.claudeDir, [t.folder]),
    ).toThrow('C9VIEW_STATE_DIR');
  } finally {
    await t.close();
  }
});

// Remote send (003): the only write is one frame on the socket.
async function snapshot(path: string, skip: string[]): Promise<unknown> {
  const info = await lstat(path);
  const base = [info.mode, info.uid];
  if (info.isDirectory())
    return [
      ...base,
      Object.fromEntries(
        await Promise.all(
          (await readdir(path))
            .filter((name) => name !== 'c9view')
            .map(async (name) => [name, await snapshot(join(path, name), skip)]),
        ),
      ),
    ];
  if (skip.includes(path)) return 'skipped';
  // A socket has no content to read; its identity and mode must stay.
  // The test never reads a key file either: size and times stand for content.
  if (!info.isFile() || path.endsWith('.key'))
    return [...base, info.ino, info.size, info.mtimeMs];
  return [
    ...base,
    info.mtimeMs,
    createHash('sha256').update(await readFile(path)).digest('hex'),
  ];
}
const harnesses: RemoteHarness[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of harnesses.splice(0)) await h.close();
});
async function remote(options: Parameters<typeof setupRemote>[0] = {}) {
  const h = await setupRemote(options);
  harnesses.push(h);
  return h;
}
async function unchanged(h: RemoteHarness, act: () => Promise<void>) {
  const skip = [h.fake.transcriptPath];
  const before = await snapshot(h.fake.root, skip);
  const kill = vi.spyOn(process, 'kill');
  opened.length = 0;
  await act();
  expect(await snapshot(h.fake.root, skip)).toEqual(before);
  // No signal but the existence probe, no key file opened, and no run or process.
  expect(kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
  expect(opened.filter((p) => p.endsWith('.key'))).toEqual([]);
  expect(h.sdk.runs).toHaveLength(0);
  expect(h.service.snapshot()).toEqual({ runs: [], requests: [] });
  kill.mockRestore();
}
const sendRemote = (h: RemoteHarness, body = h.body()) =>
  h.service.remoteSend(h.fake.projectId, h.fake.sessionId, body, h.bootId);

it('T018 remote send changes nothing but the frame: sent, replayed, delivered and not seen', async () => {
  const h = await remote({ config: { remoteNotSeenSec: 0.05 } });
  await unchanged(h, async () => {
    const body = h.body();
    await h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId);
    await sendRemote(h, body);
    await sendRemote(h, body);
    await waitFor(() => expect(h.fake.frames).toHaveLength(1));
    await waitFor(() =>
      expect(h.service.receipt(body.clientRequestId)?.delivery?.state).toBe('not-seen'),
    );
    // The terminal itself appends to its own transcript (excluded above).
    await h.fake.appendPeerRecord('user', h.fake.frames[0]!.msgId);
    await waitFor(() =>
      expect(h.service.receipt(body.clientRequestId)?.delivery?.state).toBe('delivered'),
    );
  });
  expect(opened.some((p) => p.endsWith('.json'))).toBe(true);
});
it('T018 remote refusals and failures change nothing', async () => {
  for (const live of [
    { version: '2.0.0' },
    { peerProtocol: 2 },
    { kind: 'bg' },
    { messagingSocketPath: undefined },
  ]) {
    const h = await remote({ fake: { live } });
    await unchanged(h, async () => {
      await expect(sendRemote(h)).rejects.toMatchObject({ status: 409 });
      await h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId);
    });
  }
  const stale = await remote();
  await stale.fake.stopListening();
  await unchanged(stale, async () => {
    expect((await sendRemote(stale)).status).toBe('failed');
  });
  const refused = await remote();
  await refused.fake.writeUserSettings({ crossSessionInbound: 'refuse' });
  await unchanged(refused, async () => {
    await expect(sendRemote(refused)).rejects.toMatchObject({ status: 409 });
  });
});
it('T018 never opens a *.key file and no token surfaces in any output', async () => {
  const h = await remote({ config: { remoteNotSeenSec: 0.05 } });
  opened.length = 0;
  const body = h.body('sentinel message text');
  const outputs: unknown[] = [];
  outputs.push(await h.service.remoteAvailability(h.fake.projectId, h.fake.sessionId));
  outputs.push(await sendRemote(h, body));
  await waitFor(() =>
    expect(h.service.receipt(body.clientRequestId)?.delivery?.state).toBe('not-seen'),
  );
  outputs.push(h.service.receipt(body.clientRequestId), h.seen);
  expect(opened.filter((p) => p.endsWith('.key'))).toEqual([]);
  const text = JSON.stringify(outputs);
  for (const secret of [FAKE_PEER_TOKEN, FAKE_KEY_CONTENT, 'peerToken'])
    expect(text).not.toContain(secret);
  expect(text.toLowerCase()).not.toContain('token');
});

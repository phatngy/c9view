import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setupControl, waitFor } from '../control/test-support.js';
import type { GitWriter } from './git-write.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
function gitFake(fail?: string) {
  const calls: { op: string; args: unknown[] }[] = [];
  const git: GitWriter = {
    clone: async (url, dir) => {
      calls.push({ op: 'clone', args: [url, dir] });
      if (fail) throw new Error(fail);
      await writeFile(join(dir, 'README.md'), 'x');
    },
    init: async (dir) => {
      calls.push({ op: 'init', args: [dir] });
    },
  };
  return { git, calls };
}
const body = (extra: object) => ({
  clientRequestId: randomUUID(),
  text: 'first prompt',
  ...extra,
});

it('T065 refuses disallowed URLs before anything runs', async () => {
  const { git, calls } = gitFake();
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  for (const gitUrl of [
    'file:///tmp/x',
    'ext::sh -c x',
    'git://h/o/r',
    'http://h/o/r',
    '/local/path',
  ])
    await expect(
      t.service.createProject(
        { location: join(t.work, 'p'), gitUrl, ...body({}) },
        t.bootId,
      ),
    ).rejects.toMatchObject({ status: 400, reason: 'bad-url' });
  expect(calls).toEqual([]);
});
it('T065 refuses a non-empty folder', async () => {
  const { git, calls } = gitFake();
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  await mkdir(join(t.work, 'full'));
  await writeFile(join(t.work, 'full/f'), 'x');
  await expect(
    t.service.createProject(
      {
        location: join(t.work, 'full'),
        gitUrl: 'https://h.example/o/r.git',
        ...body({}),
      },
      t.bootId,
    ),
  ).rejects.toMatchObject({ status: 400, reason: 'not-empty' });
  expect(calls).toEqual([]);
});
it('T065 clone receipt goes cloning then ready, never trusted, never starts a session', async () => {
  const { git, calls } = gitFake();
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const request = body({
    location: join(t.work, 'p'),
    gitUrl: 'git@h.example:o/r.git',
  });
  const receipt = await t.service.createProject(request as never, t.bootId);
  expect(receipt.status).toBe('cloning');
  await waitFor(() =>
    expect(t.service.receipt(request.clientRequestId)?.status).toBe('ready'),
  );
  expect(calls[0]).toEqual({
    op: 'clone',
    args: [
      'git@h.example:o/r.git',
      await import('node:fs/promises').then((m) =>
        m.realpath(join(t.work, 'p')),
      ),
    ],
  });
  expect(t.sdk.runs).toHaveLength(0);
  // The next step is the trust gate, with the summary.
  await expect(
    t.service.createProject(
      { ...body({ location: join(t.work, 'p') }) } as never,
      t.bootId,
    ),
  ).rejects.toMatchObject({ status: 409, reason: 'untrusted-folder' });
  expect(t.sdk.runs).toHaveLength(0);
});
it('T065 a failed clone is redacted, reported and removes what it created', async () => {
  const { git } = gitFake('git clone failed: denied');
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const request = body({
    location: join(t.work, 'q/p'),
    gitUrl: 'https://h.example/o/r.git',
  });
  await t.service.createProject(request as never, t.bootId);
  await waitFor(() =>
    expect(t.service.receipt(request.clientRequestId)).toMatchObject({
      status: 'failed',
      error: 'git clone failed: denied',
    }),
  );
  await expect(stat(join(t.work, 'q'))).rejects.toThrow();
});
it('T108 caps concurrent clones, answers 429 and frees the slot on success and failure', async () => {
  const gates: (() => void)[] = [];
  const fails: boolean[] = [];
  const git: GitWriter = {
    clone: (_url, _dir, signal) =>
      new Promise<void>((resolve, reject) => {
        const fail = fails.shift() ?? false;
        gates.push(() => (fail ? reject(new Error('boom')) : resolve()));
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    init: async () => undefined,
  };
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const start = (name: string) => {
    const request = body({
      location: join(t.work, name),
      gitUrl: 'https://h.example/o/r.git',
    });
    return {
      request,
      result: t.service.createProject(request as never, t.bootId),
    };
  };
  fails.push(false, true, false);
  const first = ['a', 'b', 'c'].map(start);
  for (const item of first) await item.result;
  await waitFor(() => expect(gates).toHaveLength(3));
  await expect(start('d').result).rejects.toMatchObject({
    status: 429,
    reason: 'clone-cap',
  });
  // Success frees a slot.
  gates[0]!();
  await waitFor(() =>
    expect(t.service.receipt(first[0]!.request.clientRequestId)?.status).toBe(
      'ready',
    ),
  );
  const e = start('e');
  await e.result;
  await waitFor(() => expect(gates).toHaveLength(4));
  await expect(start('f').result).rejects.toMatchObject({ status: 429 });
  // Failure frees a slot.
  gates[1]!();
  await waitFor(() =>
    expect(t.service.receipt(first[1]!.request.clientRequestId)?.status).toBe(
      'failed',
    ),
  );
  const g = start('g');
  await g.result;
  await waitFor(() => expect(gates).toHaveLength(5));
  await expect(start('h').result).rejects.toMatchObject({ status: 429 });
});
it('T108 an invalid location at the cap answers 400, and a failed plan frees nothing it did not take', async () => {
  const git: GitWriter = {
    clone: () => new Promise<void>(() => undefined),
    init: async () => undefined,
  };
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const clone = (location: string) =>
    t.service.createProject(
      body({ location, gitUrl: 'https://h.example/o/r.git' }) as never,
      t.bootId,
    );
  await mkdir(join(t.work, 'full'));
  await writeFile(join(t.work, 'full/f'), 'x');
  // planClone throwing (not empty) never consumes a slot.
  for (let i = 0; i < 5; i++)
    await expect(clone(join(t.work, 'full'))).rejects.toMatchObject({
      reason: 'not-empty',
    });
  for (const name of ['a', 'b', 'c']) await clone(join(t.work, name));
  await expect(clone(join(t.work, 'd'))).rejects.toMatchObject({
    status: 429,
  });
  // The refused clone released its claim on the location.
  await expect(clone(join(t.work, 'd'))).rejects.toMatchObject({
    status: 429,
  });
  await expect(clone('/definitely/outside')).rejects.toMatchObject({
    status: 400,
    reason: 'outside-roots',
  });
  await expect(clone(join(t.work, 'full'))).rejects.toMatchObject({
    status: 400,
    reason: 'not-empty',
  });
});
it('T108 cancelling clones (shutdown) settles them and releases their locations', async () => {
  let started = false;
  const git: GitWriter = {
    clone: (_url, _dir, signal) =>
      new Promise<void>((_resolve, reject) => {
        started = true;
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    init: async () => undefined,
  };
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const request = body({
    location: join(t.work, 'p'),
    gitUrl: 'https://h.example/o/r.git',
  });
  await t.service.createProject(request as never, t.bootId);
  const { claimLocation } = await import('./inflight.js');
  const real = join(
    await import('node:fs/promises').then((m) => m.realpath(t.work)),
    'p',
  );
  expect(() => claimLocation(real)).toThrow(/already using/);
  await waitFor(() => expect(started).toBe(true));
  await t.close();
  await waitFor(() => expect(() => claimLocation(real)()).not.toThrow());
});

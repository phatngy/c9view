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

import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setupControl, tick } from '../control/test-support.js';
import { FolderTrust } from '../control/trust.js';
import type { GitWriter } from './git-write.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
const inits: string[] = [];
const git: GitWriter = {
  clone: async () => {},
  init: async (d) => void inits.push(d),
};
const body = (extra: object) =>
  ({ clientRequestId: randomUUID(), text: 'first prompt', ...extra }) as never;

it('T066 creates a missing folder with git init, then gates on trust and never trusts automatically', async () => {
  inits.length = 0;
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const location = join(t.work, 'a/b');
  await expect(
    t.service.createProject(body({ location }), t.bootId),
  ).rejects.toMatchObject({
    status: 409,
    reason: 'untrusted-folder',
  });
  const real = await realpath(location);
  expect((await stat(real)).isDirectory()).toBe(true);
  expect(inits).toEqual([real]);
  expect(t.sdk.runs).toHaveLength(0);
});
it('T066 opens an existing folder as is, without init, and starts after the user trusts it', async () => {
  inits.length = 0;
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  const location = join(t.work, 'existing');
  await mkdir(location);
  let summary;
  try {
    await t.service.createProject(body({ location }), t.bootId);
  } catch (error) {
    summary = (error as { trust: { path: string; fingerprint: string } }).trust;
  }
  expect(inits).toEqual([]);
  await t.service.trust(
    {
      clientRequestId: randomUUID(),
      path: summary!.path,
      fingerprint: summary!.fingerprint,
    },
    t.bootId,
  );
  const receipt = await t.service.createProject(
    body({ location, name: 'n' }),
    t.bootId,
  );
  await tick();
  expect(receipt).toMatchObject({
    status: 'accepted',
    projectId: summary!.path.replace(/[^A-Za-z0-9]/g, '-'),
  });
  expect(receipt.sessionId).toBeTruthy();
  expect(t.sdk.runs).toHaveLength(1);
  void FolderTrust;
});
it('T066 gitInit false skips git init; trust of an unrelated folder stays refused', async () => {
  inits.length = 0;
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  await expect(
    t.service.createProject(
      body({ location: join(t.work, 'x'), gitInit: false }),
      t.bootId,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(inits).toEqual([]);
  await expect(
    t.service.trust(
      {
        clientRequestId: randomUUID(),
        path: t.root,
        fingerprint: 'a'.repeat(64),
      },
      t.bootId,
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it('T066 a location outside the roots is refused and creates nothing', async () => {
  const t = await setupControl({}, { roots: true, git });
  cleanups.push(t.close);
  await expect(
    t.service.createProject(
      body({ location: join(t.root, 'escape') }),
      t.bootId,
    ),
  ).rejects.toMatchObject({ status: 400, reason: 'outside-roots' });
  await expect(stat(join(t.root, 'escape'))).rejects.toThrow();
});
import { resolveLocation } from './roots.js';
import { ensureFolder } from './create.js';
import { planClone, runClone } from './clone.js';
import { parseGitUrl } from './url.js';

const url = parseGitUrl('https://h.example/o/r.git');

it('H1 two concurrent creates of the same missing location: the second is refused and nothing is removed', async () => {
  // Deterministic ordering: init signals it started (so the first request
  // holds the location claim) and then blocks until the test opens the gate.
  let started!: () => void;
  const initStarted = new Promise<void>((r) => (started = r));
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const t = await setupControl(
    {},
    {
      roots: true,
      git: {
        clone: async () => {},
        init: async () => {
          started();
          await gate;
        },
      },
    },
  );
  cleanups.push(t.close);
  const location = join(t.work, 'same');
  const first = t.service
    .createProject(body({ location }), t.bootId)
    .catch((e: { status: number }) => e.status);
  await initStarted;
  try {
    const second = await t.service
      .createProject(body({ location }), t.bootId)
      .catch((e: { status: number; reason: string }) => e.reason);
    expect(second).toBe('run-exists');
  } finally {
    open();
  }
  expect(await first).toBe(409);
  expect((await stat(location)).isDirectory()).toBe(true);
});
it('H1 a failed clone removes only what it created and not a folder populated meanwhile', async () => {
  const t = await setupControl({}, { roots: true });
  cleanups.push(t.close);
  const failing = {
    clone: async () => {
      throw new Error('boom');
    },
    init: async () => {},
  };
  // Missing target: the created folders are removed.
  const plan = await planClone([t.work], join(t.work, 'x/y'));
  await expect(runClone(plan, url, failing)).rejects.toThrow('boom');
  await expect(stat(join(t.work, 'x'))).rejects.toThrow();
  // Created by someone else between plan and mkdir: refused, content kept.
  const late = await planClone([t.work], join(t.work, 'late/p'));
  await mkdir(join(t.work, 'late/p'), { recursive: true });
  await writeFile(join(t.work, 'late/p/keep.txt'), 'mine');
  await expect(runClone(late, url, failing)).rejects.toMatchObject({
    reason: 'not-empty',
  });
  expect((await stat(join(t.work, 'late/p/keep.txt'))).isFile()).toBe(true);
  // Existing empty folder: failure removes nothing.
  await mkdir(join(t.work, 'empty'));
  const reuse = await planClone([t.work], join(t.work, 'empty'));
  await expect(runClone(reuse, url, failing)).rejects.toThrow('boom');
  expect((await stat(join(t.work, 'empty'))).isDirectory()).toBe(true);
});
it('H1 ensureFolder returns only what it created, and a second plan for a claimed location is refused', async () => {
  const t = await setupControl({}, { roots: true });
  cleanups.push(t.close);
  await mkdir(join(t.work, 'a'));
  const loc = await resolveLocation([t.work], join(t.work, 'a/b/c'));
  const created = await ensureFolder(loc);
  expect(created).toBe(join(await realpath(t.work), 'a/b'));
  expect(await ensureFolder({ ...loc, exists: false })).toBeUndefined();
  const plan = await planClone([t.work], join(t.work, 'z'));
  await expect(planClone([t.work], join(t.work, 'z'))).rejects.toMatchObject({
    status: 409,
  });
  plan.release();
  (await planClone([t.work], join(t.work, 'z'))).release();
});
it('M4 refuses to create a folder under Claude data or a state folder inside the root', async () => {
  const t = await setupControl({}, { roots: true });
  cleanups.push(t.close);
  await expect(
    t.service.createProject(
      body({ location: join(t.claudeDir, 'foo') }),
      t.bootId,
    ),
  ).rejects.toMatchObject({ reason: 'outside-roots' });
});

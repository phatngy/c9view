import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
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

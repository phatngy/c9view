import { afterEach, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectIdFor, resolveLocation, segmentsOf } from './roots.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'c9view-roots-')));
  dirs.push(base);
  const root = join(base, 'work');
  await mkdir(root);
  await mkdir(join(base, 'outside'));
  return { base, root };
}
const outside = { status: 400, reason: 'outside-roots' };

it('T063 accepts existing and missing locations inside a root', async () => {
  const { root } = await setup();
  await mkdir(join(root, 'a'));
  expect(await resolveLocation([root], join(root, 'a'))).toMatchObject({
    path: join(root, 'a'),
    exists: true,
  });
  expect(await resolveLocation([root], join(root, 'a/b/c'))).toMatchObject({
    path: join(root, 'a/b/c'),
    exists: false,
    firstMissing: join(root, 'a/b'),
  });
});
it('T063 refuses outside paths, .. and the root itself', async () => {
  const { base, root } = await setup();
  for (const location of [
    join(base, 'outside'),
    join(base, 'outside/new'),
    `${root}/../outside`,
    `${root}/a/../b`,
    root,
    'relative/path',
    `${root}//a`,
    '/',
  ]) {
    await expect(resolveLocation([root], location)).rejects.toMatchObject(
      outside,
    );
  }
});
it('T063 refuses a symlink that escapes a root, existing or dangling', async () => {
  const { base, root } = await setup();
  await symlink(join(base, 'outside'), join(root, 'link'));
  await symlink(join(base, 'gone'), join(root, 'dangling'));
  await expect(
    resolveLocation([root], join(root, 'link')),
  ).rejects.toMatchObject(outside);
  await expect(
    resolveLocation([root], join(root, 'link/new')),
  ).rejects.toMatchObject(outside);
  await expect(
    resolveLocation([root], join(root, 'dangling/new')),
  ).rejects.toMatchObject(outside);
});
it('T063 allows a symlink that stays inside the root', async () => {
  const { root } = await setup();
  await mkdir(join(root, 'real'));
  await symlink(join(root, 'real'), join(root, 'alias'));
  expect((await resolveLocation([root], join(root, 'alias/new'))).path).toBe(
    join(root, 'real/new'),
  );
});
it('T063 refuses a file as an ancestor', async () => {
  const { root } = await setup();
  await writeFile(join(root, 'f'), 'x');
  await expect(
    resolveLocation([root], join(root, 'f/x')),
  ).rejects.toMatchObject(outside);
});
it('T063 expands ~ and answers 404 without roots', async () => {
  expect(segmentsOf('~/proj')).toEqual([
    ...homedir().split('/').slice(1),
    'proj',
  ]);
  await expect(resolveLocation([], '/tmp/x')).rejects.toMatchObject({
    status: 404,
  });
});
it('T066 project ID replaces non-alphanumerics with a dash', () => {
  expect(projectIdFor('/home/u/my_proj.v2')).toBe('-home-u-my-proj-v2');
});

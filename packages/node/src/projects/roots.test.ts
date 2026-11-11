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
it("T066 project ID is core's encodeProjectPath", async () => {
  const { encodeProjectPath } = await import('@c9view/core');
  for (const path of ['/home/u/my_proj.v2', '/é/中文', '/a b/c'])
    expect(projectIdFor(path)).toBe(encodeProjectPath(path));
});
it('refuses locations whose project ID would be hashed by Claude Code (> 200 characters)', async () => {
  const { root } = await setup();
  await expect(
    resolveLocation([root], join(root, 'a'.repeat(210))),
  ).rejects.toMatchObject({ status: 400 });
});
it('M4 refuses locations inside or containing Claude data or the state folder', async () => {
  const { base, root } = await setup();
  const claudeDir = join(root, '.claude');
  const stateDir = join(base, 'outside/state');
  await mkdir(claudeDir);
  const forbidden = [claudeDir, stateDir];
  for (const location of [
    join(claudeDir, 'foo'),
    claudeDir,
    join(claudeDir, 'c9view/x'),
  ])
    await expect(
      resolveLocation([root], location, forbidden),
    ).rejects.toMatchObject(outside);
  // A state folder outside the root, and a root that contains it.
  await expect(
    resolveLocation([base], join(base, 'outside/state/p'), forbidden),
  ).rejects.toMatchObject(outside);
  await expect(
    resolveLocation([base], join(base, 'outside'), forbidden),
  ).rejects.toMatchObject(outside);
  expect(
    (await resolveLocation([root], join(root, 'ok'), forbidden)).path,
  ).toBe(join(root, 'ok'));
});
it('does not trim folder names', async () => {
  const { root } = await setup();
  expect((await resolveLocation([root], join(root, ' a '))).path).toBe(
    join(root, ' a '),
  );
  await expect(resolveLocation([root], ` ${root}/a`)).rejects.toMatchObject(
    outside,
  );
});

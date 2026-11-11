import { afterEach, expect, it } from 'vitest';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browse } from './browse.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'c9view-browse-')));
  dirs.push(base);
  const root = join(base, 'work');
  await mkdir(join(root, 'b'), { recursive: true });
  await mkdir(join(root, 'a'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'file.txt'), 'x');
  await mkdir(join(base, 'outside'));
  await symlink(join(base, 'outside'), join(root, 'link'));
  return { base, root };
}
it('T067 lists the roots first, then one level of directories', async () => {
  const { root } = await setup();
  expect((await browse([root], undefined, false)).entries).toEqual([
    { name: root, path: root },
  ]);
  const level = await browse([root], root, false);
  expect(level.entries.map((e) => e.name)).toEqual(['a', 'b']);
  expect(level.parent).toBeUndefined();
  expect((await browse([root], join(root, 'a'), false)).parent).toBe(root);
});
it('T067 shows hidden folders only on request and never files or symlinks', async () => {
  const { root } = await setup();
  expect((await browse([root], root, true)).entries.map((e) => e.name)).toEqual(
    ['.hidden', 'a', 'b'],
  );
});
it('T067 refuses paths outside the roots', async () => {
  const { base, root } = await setup();
  await expect(
    browse([root], join(base, 'outside'), false),
  ).rejects.toMatchObject({ status: 400, reason: 'outside-roots' });
  await expect(browse([root], join(root, 'link'), false)).rejects.toMatchObject(
    { status: 400, reason: 'outside-roots' },
  );
  await expect(
    browse([root], `${root}/../outside`, false),
  ).rejects.toMatchObject({ status: 400 });
  await expect(browse([], undefined, false)).rejects.toMatchObject({
    status: 404,
  });
});

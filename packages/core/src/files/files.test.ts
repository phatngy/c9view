import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  stat,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createFileAccess } from './index.js';
import { createGit, parseGitDiff } from '../git/index.js';
let dir: string, root: string;
const secret = 'sk-ant-fixture-secret-1234567890';
function git(...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd: root },
  );
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-files-'));
  root = join(dir, 'project');
  await mkdir(root);
  git('init', '-q');
  await writeFile(join(root, 'tracked.ts'), 'before\n');
  git('add', '.');
  git('commit', '-qm', 'fixture');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
describe('safe files and read-only git', () => {
  it('rejects traversal, absolute, encoded and symlink escapes, including denied symlink targets', async () => {
    const files = createFileAccess({ root });
    await writeFile(join(dir, 'outside'), 'private');
    await symlink(join(dir, 'outside'), join(root, 'escape'));
    await writeFile(join(root, '.env'), 'private');
    await symlink('.env', join(root, 'alias'));
    for (const path of [
      '../outside',
      '/etc/passwd',
      '%2e%2e/outside',
      '..%2foutside',
      'a\0b',
      'escape',
      'alias',
      'C:\\private',
    ])
      await expect(files.resolveSafe(path)).rejects.toThrow();
    expect(await files.listDir()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'escape',
          type: 'symlink',
          outside: true,
          denied: true,
        }),
        expect.objectContaining({ name: 'alias', denied: true }),
      ]),
    );
  });
  it('lists denied metadata without content or size; hides dependency/git folders; marks ignores', async () => {
    await mkdir(join(root, '.ssh'));
    await mkdir(join(root, 'node_modules'));
    for (const path of ['.env.local', 'id_rsa', '.ssh/config', 'ignored.txt'])
      await writeFile(join(root, path), 'private');
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
    const files = createFileAccess({ root });
    const entries = await files.listDir();
    expect(
      entries.some((e) => e.name === '.git' || e.name === 'node_modules'),
    ).toBe(false);
    expect(entries.find((e) => e.name === 'ignored.txt')?.ignored).toBe(true);
    for (const path of ['.env.local', 'id_rsa', '.ssh']) {
      expect(entries.find((e) => e.name === path)).toMatchObject({
        denied: true,
        reason: 'sensitive path',
      });
      expect(entries.find((e) => e.name === path)).not.toHaveProperty('size');
      await expect(files.readFile(path)).rejects.toThrow();
    }
    await expect(files.readFile('.ssh/config')).rejects.toThrow();
    expect(
      (
        await createFileAccess({ root, extraDeny: ['tracked.ts'] }).listDir()
      ).find((e) => e.name === 'tracked.ts')?.denied,
    ).toBe(true);
  });
  it('redacts normal content, detects binary, and never returns large content', async () => {
    await writeFile(join(root, 'secret.ts'), `const value = '${secret}';\n`);
    await writeFile(join(root, 'binary'), Buffer.from([1, 0, 2]));
    await writeFile(join(root, 'large'), 'x'.repeat(1_000_001));
    const files = createFileAccess({ root });
    expect(await files.readFile('secret.ts')).toMatchObject({
      language: 'typescript',
      binary: false,
      tooLarge: false,
    });
    expect((await files.readFile('secret.ts')).content).not.toContain(secret);
    expect(await files.readFile('binary')).toMatchObject({ binary: true });
    expect(await files.readFile('binary')).not.toHaveProperty('content');
    expect(await files.readFile('large')).toMatchObject({
      tooLarge: true,
      size: 1_000_001,
    });
    expect(await files.readFile('large')).not.toHaveProperty('content');
  });
  it('reads staged and unstaged changes, additions and HEAD without changing the index', async () => {
    await writeFile(join(root, 'tracked.ts'), `after ${secret}\n`);
    await writeFile(join(root, 'new file.ts'), 'new\n');
    await writeFile(join(root, '.env'), 'hidden\n');
    await writeFile(join(root, 'binary'), Buffer.from([0, 1]));
    const index = join(root, '.git/index');
    const before = await stat(index);
    const bytes = await readFile(index);
    const repo = createGit(root);
    expect(await repo.isRepo()).toBe(true);
    expect(await repo.status()).toMatchObject({
      ahead: 0,
      behind: 0,
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'tracked.ts', status: 'modified' }),
        expect.objectContaining({ path: 'new file.ts', status: 'untracked' }),
      ]),
    });
    const diff = await repo.diff();
    expect(diff).toContain('+new');
    expect(diff).not.toContain(secret);
    expect(diff).not.toContain('hidden');
    expect(
      parseGitDiff(diff).find((f) => f.path === 'new file.ts')?.hunks,
    ).toHaveLength(1);
    expect(await repo.fileAtHead('tracked.ts')).toBe('before\n');
    expect((await stat(index)).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(index)).toEqual(bytes);
    await expect(repo.diff('../outside')).rejects.toThrow();
    expect(await createGit(dir).isRepo()).toBe(false);
  });
  it('parses staged renames and deleted files with spaces', async () => {
    git('mv', 'tracked.ts', 'renamed file.ts');
    const repo = createGit(root);
    expect((await repo.status()).files).toEqual([
      expect.objectContaining({ path: 'renamed file.ts', status: 'renamed' }),
    ]);
    expect(await repo.diff()).toContain('before');
  });
});

it('scopes git paths to a project inside a repository and includes nested deletions', async () => {
  await mkdir(join(root, 'sub'));
  await writeFile(join(root, 'sub/file.ts'), 'old\n');
  git('add', '.');
  git('commit', '-qm', 'nested fixture');
  await writeFile(join(root, 'sub/file.ts'), 'new\n');
  const sub = createGit(join(root, 'sub'));
  expect((await sub.status()).files).toEqual([
    expect.objectContaining({ path: 'file.ts' }),
  ]);
  expect(parseGitDiff(await sub.diff())[0]?.path).toBe('file.ts');
  await rm(join(root, 'sub'), { recursive: true });
  expect((await createGit(root).status()).files).toEqual([
    expect.objectContaining({ path: 'sub/file.ts', status: 'deleted' }),
  ]);
  expect(await createGit(root).diff()).toContain('-old');
});

it('denies git components for reading and listing in all path forms', async () => {
  const files = createFileAccess({ root });
  await symlink('.git', join(root, 'git-alias'));
  for (const path of [
    '.git/config',
    '.git/HEAD',
    './.git/config',
    '.git/../.git/config',
    '.git%2fconfig',
    '.GIT/config',
    'git-alias/config',
  ]) {
    await expect(files.readFile(path)).rejects.toThrow();
    await expect(files.listDir(path)).rejects.toThrow();
  }
});

it('applies sensitive policy relative to a project under .config and only denies SSH id names', async () => {
  const nested = join(dir, '.config/project');
  await mkdir(nested, { recursive: true });
  const files = createFileAccess({ root: nested });
  await writeFile(join(nested, 'id_component.ts'), 'public');
  await writeFile(join(nested, 'id_utils.ts'), 'public');
  expect((await files.readFile('id_utils.ts')).content).toBe('public');
  expect((await files.readFile('id_component.ts')).content).toBe('public');
  for (const name of [
    'id_rsa',
    'id_dsa.pub',
    'id_ecdsa',
    'id_ed25519.pub',
    'id_ecdsa_sk',
    'id_ed25519_sk.pub',
    'id_rsa.bak',
    'id_rsa_old',
  ]) {
    await writeFile(join(nested, name), 'private');
    await expect(files.readFile(name)).rejects.toThrow();
  }
  expect(
    (await files.listDir()).find((e) => e.name === 'id_component.ts')?.denied,
  ).toBeUndefined();
});

it('reports FIFOs and sockets as other and never reads them', async () => {
  const { createServer } = await import('node:net');
  execFileSync('mkfifo', [join(root, 'pipe')]);
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(join(root, 'socket'), resolve),
  );
  try {
    const files = createFileAccess({ root });
    for (const name of ['pipe', 'socket']) {
      expect((await files.listDir()).find((e) => e.name === name)?.type).toBe(
        'other',
      );
      await expect(files.readFile(name)).rejects.toThrow();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('revalidates opened file identity without procfs on other platforms', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    expect(
      (await createFileAccess({ root }).readFile('tracked.ts')).content,
    ).toBe('before\n');
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});

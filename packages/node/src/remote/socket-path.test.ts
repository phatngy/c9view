import { afterEach, describe, expect, it } from 'vitest';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { socketPathOwned } from './socket-path.js';

const uid = process.getuid!();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
function listen(path: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(path, () => resolve(server));
    cleanups.push(
      () => new Promise<void>((done) => server.close(() => done())),
    );
  });
}
async function setup(pid = 4242) {
  const root = await mkdtemp(join(tmpdir(), 'c9sp-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'run');
  const folder = join(runtime, 'cc-socks');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(runtime, 0o700);
  await chmod(folder, 0o700);
  const path = join(folder, `${pid}.sock`);
  await listen(path);
  await chmod(path, 0o600);
  return {
    root,
    runtime,
    folder,
    path,
    pid,
    env: { XDG_RUNTIME_DIR: runtime },
  };
}

describe('T032 socket path ownership', () => {
  it('accepts the bare socket in $XDG_RUNTIME_DIR/cc-socks', async () => {
    const s = await setup();
    expect(await socketPathOwned(s.path, s.pid, { env: s.env })).toBe(true);
  });
  it('accepts every allowed folder shape (mocked ownership)', async () => {
    const stat = (socket: boolean) => ({
      isDirectory: () => !socket,
      isSocket: () => socket,
      uid: 1000,
      mode: socket ? 0o140600 : 0o040700,
    });
    const lstat = async (p: string) => stat(p.endsWith('.sock'));
    for (const path of [
      '/run/user/1000/cc-socks/7.sock',
      '/var/tmpx/cc-socks-1000/7.sock',
      '/tmp/cc-socks-1000/7.sock',
      '/xdg/cc-socks/7.sock',
    ])
      expect(
        await socketPathOwned(path, 7, {
          uid: 1000,
          tmp: '/var/tmpx',
          env: { XDG_RUNTIME_DIR: '/xdg' },
          lstat,
        }),
      ).toBe(true);
  });
  it.each([
    ['wrong folder', '/etc/cc-socks/7.sock'],
    ['wrong uid folder', '/tmp/cc-socks-1001/7.sock'],
    ['wrong name', '/tmp/cc-socks-1000/8.sock'],
    ['not .sock', '/tmp/cc-socks-1000/7'],
    ['uds prefix', 'uds:/tmp/cc-socks-1000/7.sock'],
    ['relative', 'cc-socks-1000/7.sock'],
    ['traversal', '/tmp/cc-socks-1000/../cc-socks-1000/7.sock'],
    ['double slash', '/tmp//cc-socks-1000/7.sock'],
    ['nested', '/tmp/cc-socks-1000/x/7.sock'],
    ['nul', '/tmp/cc-socks-1000/7.sock\0'],
    ['not a string', 7],
    ['empty', ''],
  ])('refuses %s without touching the file system', async (_n, path) => {
    const lstat = async () => {
      throw new Error('must not stat');
    };
    expect(
      await socketPathOwned(path, 7, {
        uid: 1000,
        tmp: '/tmp',
        env: {},
        lstat,
      }),
    ).toBe(false);
  });
  it('refuses a foreign owner for the socket or the folder', async () => {
    const s = await setup();
    const real = await import('node:fs/promises');
    const foreign = (match: string) => async (p: string) => {
      const info = await real.lstat(p);
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
        uid: p.endsWith(match) ? uid + 1 : info.uid,
      });
    };
    expect(
      await socketPathOwned(s.path, s.pid, {
        env: s.env,
        lstat: foreign('.sock'),
      }),
    ).toBe(false);
    expect(
      await socketPathOwned(s.path, s.pid, {
        env: s.env,
        lstat: foreign('cc-socks'),
      }),
    ).toBe(false);
  });
  it('refuses group or other access on the socket and write access on the folder', async () => {
    for (const mode of [0o640, 0o604, 0o660, 0o666, 0o644]) {
      const s = await setup();
      await chmod(s.path, mode);
      expect(await socketPathOwned(s.path, s.pid, { env: s.env })).toBe(false);
    }
    for (const mode of [0o770, 0o707, 0o702, 0o720]) {
      const s = await setup();
      await chmod(s.folder, mode);
      expect(await socketPathOwned(s.path, s.pid, { env: s.env })).toBe(false);
    }
  });
  it('refuses a non-socket, a symlinked socket and a symlinked folder', async () => {
    const s = await setup();
    await writeFile(join(s.folder, '99.sock'), '', { mode: 0o600 });
    expect(
      await socketPathOwned(join(s.folder, '99.sock'), 99, { env: s.env }),
    ).toBe(false);
    await symlink(s.path, join(s.folder, '98.sock'));
    expect(
      await socketPathOwned(join(s.folder, '98.sock'), 98, { env: s.env }),
    ).toBe(false);
    const other = await mkdtemp(join(tmpdir(), 'c9sp-'));
    cleanups.push(() => rm(other, { recursive: true, force: true }));
    const real = join(other, 'real');
    await mkdir(real, { mode: 0o700 });
    await listen(join(real, '5.sock'));
    await chmod(join(real, '5.sock'), 0o600);
    const run = join(other, 'run');
    await mkdir(run, { mode: 0o700 });
    await symlink(real, join(run, 'cc-socks'));
    expect(
      await socketPathOwned(join(run, 'cc-socks', '5.sock'), 5, {
        env: { XDG_RUNTIME_DIR: run },
      }),
    ).toBe(false);
  });
  it('refuses a missing socket', async () => {
    const s = await setup();
    expect(
      await socketPathOwned(join(s.folder, '1.sock'), 1, { env: s.env }),
    ).toBe(false);
  });
});

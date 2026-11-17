import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLive, type LiveJudge } from './discovery.js';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
async function claude() {
  const dir = await mkdtemp(join(tmpdir(), 'c9disc-'));
  roots.push(dir);
  await mkdir(join(dir, 'sessions'));
  return dir;
}
const put = (dir: string, name: string, value: unknown) =>
  writeFile(
    join(dir, 'sessions', name),
    typeof value === 'string' ? value : JSON.stringify(value),
  );
const SENTINEL = 'sentinel-peer-token-0001';

describe('T020 discovery', () => {
  it('parses the picked fields and drops everything else, including peerToken', async () => {
    const dir = await claude();
    await put(dir, '10.json', {
      sessionId: 's1',
      pid: 10,
      procStart: '123',
      pidDomain: 'linux:abc:pid:[4026531836]',
      kind: 'interactive',
      entrypoint: 'cli',
      version: '2.1.325',
      peerProtocol: 1,
      messagingSocketPath: '/run/user/1/cc-socks/10.sock',
      status: 'idle',
      cwd: '/p',
      peerToken: SENTINEL,
      waitingFor: 'dialog open',
      name: 'n',
      tmux: 't',
      peerFeatures: ['x'],
    });
    const result = await readLive(dir, 's1');
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(Object.keys(result.entry).sort()).toEqual(
      [
        'cwd',
        'entrypoint',
        'kind',
        'messagingSocketPath',
        'peerProtocol',
        'pid',
        'pidDomain',
        'procStart',
        'sessionId',
        'status',
        'version',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });
  it('treats every field except sessionId as optional and tolerant of bad types', async () => {
    const dir = await claude();
    await put(dir, '1.json', {
      sessionId: 's1',
      pid: -4,
      procStart: 123,
      pidDomain: { x: 1 },
      peerProtocol: 1.5,
      version: 5,
      status: null,
    });
    expect(await readLive(dir, 's1')).toEqual({
      kind: 'found',
      entry: { sessionId: 's1' },
    });
  });
  it('rejects a procStart that is not a decimal string of digits', async () => {
    const dir = await claude();
    await put(dir, '1.json', { sessionId: 's1', procStart: '12a' });
    const r = await readLive(dir, 's1');
    expect(r.kind === 'found' && r.entry.procStart).toBeUndefined();
  });
  it('matches only the requested session and reads fresh each time', async () => {
    const dir = await claude();
    await put(dir, '1.json', { sessionId: 'other' });
    expect(await readLive(dir, 's1')).toEqual({ kind: 'none' });
    await put(dir, '2.json', { sessionId: 's1', status: 'idle' });
    expect((await readLive(dir, 's1')).kind).toBe('found');
    await put(dir, '2.json', { sessionId: 's1', status: 'busy' });
    const again = await readLive(dir, 's1');
    expect(again.kind === 'found' && again.entry.status).toBe('busy');
    await rm(join(dir, 'sessions', '2.json'));
    expect(await readLive(dir, 's1')).toEqual({ kind: 'none' });
  });
  it('is none without a sessions folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'c9disc-'));
    roots.push(dir);
    expect(await readLive(dir, 's1')).toEqual({ kind: 'none' });
  });
  it('skips a token-only file silently', async () => {
    const dir = await claude();
    await put(dir, '3.json', {
      peerToken: SENTINEL,
      pidDomain: 'x',
      procStart: '5',
    });
    expect(await readLive(dir, 's1')).toEqual({ kind: 'none' });
  });
  it('is unknown for two entries, or an unparsable file that names the session', async () => {
    const dir = await claude();
    await put(dir, '1.json', { sessionId: 's1' });
    await put(dir, '2.json', { sessionId: 's1' });
    expect(await readLive(dir, 's1')).toEqual({ kind: 'unknown' });
    const dir2 = await claude();
    await put(dir2, '1.json', '{"sessionId":"s1", broken');
    expect(await readLive(dir2, 's1')).toEqual({ kind: 'unknown' });
    const dir3 = await claude();
    await put(dir3, '1.json', '{"sessionId":"zzz", broken');
    expect(await readLive(dir3, 's1')).toEqual({ kind: 'none' });
  });
  it('never opens *.key files, and ignores their content', async () => {
    const dir = await claude();
    await put(dir, '1.json', { sessionId: 's1' });
    await writeFile(join(dir, 'sessions', '1.abcd.key'), SENTINEL);
    // A key file that names the session must not matter: it is not a .json name.
    await writeFile(join(dir, 'sessions', '2.abcd.key'), '{"sessionId":"s1"}');
    const r = await readLive(dir, 's1');
    expect(r.kind).toBe('found');
  });
});

describe('duplicate entries for one session', () => {
  const NS = '4026531836';
  const entry = (pid: number, extra: Record<string, unknown> = {}) => ({
    sessionId: 's1',
    pid,
    procStart: String(pid * 10),
    pidDomain: `linux:h:pid:[${NS}]`,
    ...extra,
  });
  const judge = (liveStarts: Record<number, string>): LiveJudge => ({
    alive: (pid) => pid in liveStarts,
    procStartOf: (pid) => liveStarts[pid] ?? null,
    namespace: async () => NS,
  });
  it('a stale entry (dead PID) beside one live entry gives the live one', async () => {
    const dir = await claude();
    await put(dir, '1.json', entry(1));
    await put(dir, '2.json', entry(2));
    const r = await readLive(dir, 's1', judge({ 2: '20' }));
    expect(r.kind === 'found' && r.entry.pid).toBe(2);
  });
  it('an entry whose PID now has another start time is stale', async () => {
    const dir = await claude();
    await put(dir, '1.json', entry(1));
    await put(dir, '2.json', entry(2));
    const r = await readLive(dir, 's1', judge({ 1: '999', 2: '20' }));
    expect(r.kind === 'found' && r.entry.pid).toBe(2);
  });
  it('two live entries are unknown', async () => {
    const dir = await claude();
    await put(dir, '1.json', entry(1));
    await put(dir, '2.json', entry(2));
    expect(await readLive(dir, 's1', judge({ 1: '10', 2: '20' }))).toEqual({
      kind: 'unknown',
    });
  });
  it('a stale entry beside one that cannot be judged is unknown', async () => {
    for (const odd of [
      entry(2, { pidDomain: 'linux:h:pid:[1]' }),
      entry(2, { pidDomain: undefined }),
      entry(2, { pid: undefined }),
    ]) {
      const dir = await claude();
      await put(dir, '1.json', entry(1));
      await put(dir, '2.json', odd);
      expect(await readLive(dir, 's1', judge({}))).toEqual({ kind: 'unknown' });
    }
    const dir = await claude();
    await put(dir, '1.json', entry(1));
    await put(dir, '2.json', entry(2));
    expect(
      await readLive(dir, 's1', {
        ...judge({ 2: '20' }),
        namespace: async () => undefined,
      }),
    ).toEqual({ kind: 'unknown' });
  });
  it('without a judge, duplicates stay unknown; all stale is none', async () => {
    const dir = await claude();
    await put(dir, '1.json', entry(1));
    await put(dir, '2.json', entry(2));
    expect(await readLive(dir, 's1')).toEqual({ kind: 'unknown' });
    expect(await readLive(dir, 's1', judge({}))).toEqual({ kind: 'none' });
  });
});

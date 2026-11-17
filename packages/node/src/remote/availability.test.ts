import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ControlError } from '../control/errors.js';
import { createAvailability, type AvailabilityDeps } from './availability.js';
import {
  FAKE_KEY_CONTENT,
  FAKE_PEER_TOKEN,
  createFakeSession,
  type FakeSession,
  type FakeSessionOptions,
} from './fake-session.js';

const opened: string[] = [];
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      opened.push(String(args[0]));
      return actual.readFile(...args);
    }) as typeof actual.readFile,
    open: ((...args: Parameters<typeof actual.open>) => {
      opened.push(String(args[0]));
      return actual.open(...args);
    }) as typeof actual.open,
  };
});
const open: FakeSession[] = [];
afterEach(async () => {
  for (const f of open.splice(0)) await f.close();
});
async function setup(
  options: FakeSessionOptions = {},
  deps: Partial<AvailabilityDeps> = {},
) {
  const fake = await createFakeSession(options);
  open.push(fake);
  const check = createAvailability({
    claudeDir: fake.claudeDir,
    env: fake.env,
    sessionExists: async () => true,
    ownRun: () => false,
    capped: () => false,
    ...deps,
  });
  return { fake, check, run: () => check(fake.projectId, fake.sessionId) };
}

describe('T034 availability, ordered R7 gate', () => {
  it('is available for the fake terminal session, with a target that is not in the availability', async () => {
    const { fake, run } = await setup();
    const { availability, target } = await run();
    expect(availability).toMatchObject({
      sessionId: fake.sessionId,
      available: true,
      sessionState: 'idle',
    });
    expect(availability.reason).toBeUndefined();
    expect(availability.inbound).toBeUndefined();
    expect(Date.parse(availability.checkedAt)).not.toBeNaN();
    expect(target).toEqual({
      pid: fake.pid,
      procStart: fake.procStart,
      socketPath: fake.socketPath,
    });
    const text = JSON.stringify(availability);
    for (const secret of [
      fake.socketPath,
      String(fake.pid),
      '2.1.325',
      FAKE_PEER_TOKEN,
    ])
      expect(text).not.toContain(secret);
  });
  it('1 control-unavailable at the tombstone cap', async () => {
    const { run } = await setup({}, { capped: () => true });
    expect((await run()).availability.reason).toBe('control-unavailable');
  });
  it('2 unsupported-platform off Linux', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const { run } = await setup({}, { platform });
      expect((await run()).availability.reason).toBe('unsupported-platform');
    }
  });
  it('3 a missing session is a 404', async () => {
    const { run } = await setup({}, { sessionExists: async () => false });
    await expect(run()).rejects.toBeInstanceOf(ControlError);
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });
  it('4 own-run selects 002 reply', async () => {
    const { run } = await setup({}, { ownRun: () => true });
    expect((await run()).availability.reason).toBe('own-run');
  });
  it('5 duplicate or unparsable entries are liveness-unknown', async () => {
    const a = await setup();
    await writeFile(
      join(a.fake.claudeDir, 'sessions', '999999.json'),
      JSON.stringify({ sessionId: a.fake.sessionId }),
    );
    expect((await a.run()).availability.reason).toBe('liveness-unknown');
    const b = await setup();
    await writeFile(
      join(b.fake.claudeDir, 'sessions', 'x.json'),
      `{"sessionId":"${b.fake.sessionId}",`,
    );
    expect((await b.run()).availability.reason).toBe('liveness-unknown');
  });
  it('6 no entry, a dead PID, or a stale file is not-live', async () => {
    const none = await setup();
    await none.fake.removeLive();
    expect((await none.run()).availability.reason).toBe('not-live');
    const dead = await setup(
      { live: { status: 'busy' } },
      { alive: () => false },
    );
    const out = await dead.run();
    expect(out.availability.reason).toBe('not-live');
    expect(out.availability.sessionState).toBeUndefined();
    expect(out.target).toBeUndefined();
  });
  it('7 a missing pid or another PID namespace is liveness-unknown', async () => {
    const noPid = await setup({ live: { pid: undefined } });
    expect((await noPid.run()).availability.reason).toBe('liveness-unknown');
    const noDomain = await setup({ live: { pidDomain: undefined } });
    expect((await noDomain.run()).availability.reason).toBe('liveness-unknown');
    const other = await setup({ live: { pidDomain: 'linux:x:pid:[1]' } });
    expect((await other.run()).availability.reason).toBe('liveness-unknown');
    const unreadable = await setup({}, { namespace: async () => undefined });
    expect((await unreadable.run()).availability.reason).toBe(
      'liveness-unknown',
    );
  });
  it('8 a procStart mismatch (PID reuse) or a malformed one is address-invalid', async () => {
    for (const procStart of ['1', undefined]) {
      const s = await setup({ live: { procStart } });
      expect((await s.run()).availability.reason).toBe('address-invalid');
    }
    const gone = await setup({}, { procStartOf: () => null });
    expect((await gone.run()).availability.reason).toBe('address-invalid');
  });
  it.each([
    ['bg', 'cli'],
    ['daemon', 'cli'],
    ['daemon-worker', 'cli'],
    ['interactive', 'sdk-cli'],
    ['interactive', undefined],
    [undefined, 'cli'],
  ])('9 kind %s entrypoint %s is not-interactive', async (kind, entrypoint) => {
    const s = await setup({ live: { kind, entrypoint } });
    expect((await s.run()).availability.reason).toBe('not-interactive');
  });
  it.each([['2.1.317'], ['1.0.0'], [undefined], ['2.1.325-beta'], ['garbage']])(
    '10 version %s is too-old with the minimum',
    async (version) => {
      const s = await setup({ live: { version } });
      const { availability } = await s.run();
      expect(availability.reason).toBe('too-old');
      expect(availability.minVersion).toBe('2.1.318');
    },
  );
  it('10 the exact minimum and newer are available', async () => {
    for (const version of ['2.1.318', '2.2.0', '3.0.0']) {
      const s = await setup({ live: { version } });
      expect((await s.run()).availability.available).toBe(true);
    }
  });
  it('11 an unknown protocol', async () => {
    for (const peerProtocol of [2, undefined, 0]) {
      const s = await setup({ live: { peerProtocol } });
      expect((await s.run()).availability.reason).toBe('unknown-protocol');
    }
  });
  it('12 no address', async () => {
    const s = await setup({ live: { messagingSocketPath: undefined } });
    expect((await s.run()).availability.reason).toBe('no-address');
  });
  it('13 and 14 a bad address, folder or socket is address-invalid', async () => {
    const wrongName = await setup();
    await wrongName.fake.writeLive({
      messagingSocketPath: join(
        wrongName.fake.runtimeDir,
        'cc-socks',
        '1.sock',
      ),
    });
    expect((await wrongName.run()).availability.reason).toBe('address-invalid');
    const wrongFolder = await setup();
    await wrongFolder.fake.writeLive({
      messagingSocketPath: join(
        wrongFolder.fake.root,
        `${wrongFolder.fake.pid}.sock`,
      ),
    });
    expect((await wrongFolder.run()).availability.reason).toBe(
      'address-invalid',
    );
    const uds = await setup();
    await uds.fake.writeLive({
      messagingSocketPath: `uds:${uds.fake.socketPath}`,
    });
    expect((await uds.run()).availability.reason).toBe('address-invalid');
    const mode = await setup();
    await chmod(mode.fake.socketPath, 0o644);
    expect((await mode.run()).availability.reason).toBe('address-invalid');
    const folder = await setup();
    await chmod(join(folder.fake.runtimeDir, 'cc-socks'), 0o777);
    expect((await folder.run()).availability.reason).toBe('address-invalid');
    const foreign = await setup({}, { uid: process.getuid!() + 1 });
    expect((await foreign.run()).availability.reason).toBe('address-invalid');
    const missing = await setup();
    await missing.fake.removeSocket();
    expect((await missing.run()).availability.reason).toBe('address-invalid');
  });
  it('15 refused settings are inbound-refused; hold and may-hold stay available', async () => {
    const refused = await setup();
    await refused.fake.writeProjectSettings(
      { crossSessionInbound: 'refuse' },
      true,
    );
    const out = await refused.run();
    expect(out.availability.reason).toBe('inbound-refused');
    expect(out.target).toBeUndefined();
    const hold = await setup();
    await hold.fake.writeUserSettings({ crossSessionInbound: 'hold' });
    const held = await hold.run();
    expect(held.availability).toMatchObject({
      available: true,
      inbound: 'hold',
    });
    expect(held.target).toBeDefined();
    const bypass = await setup({ permissionMode: 'bypassPermissions' });
    expect((await bypass.run()).availability.inbound).toBe('may-hold');
    const unknownMode = await setup({ permissionMode: null });
    expect((await unknownMode.run()).availability.inbound).toBe('may-hold');
    const accept = await setup({ permissionMode: 'bypassPermissions' });
    await accept.fake.writeUserSettings({ crossSessionInbound: 'accept' });
    expect((await accept.run()).availability.inbound).toBeUndefined();
  });
  it('maps status to sessionState and never forwards other text', async () => {
    for (const [status, expected] of [
      ['busy', 'busy'],
      ['waiting', 'waiting'],
      ['idle', 'idle'],
      ['something else', 'unknown'],
      [undefined, 'unknown'],
    ] as const) {
      const s = await setup({ live: { status, waitingFor: 'private dialog' } });
      const { availability } = await s.run();
      expect(availability.sessionState).toBe(expected);
      expect(JSON.stringify(availability)).not.toContain('private dialog');
    }
  });
  it('rechecks every time: a change between two checks is seen', async () => {
    const s = await setup();
    expect((await s.run()).availability.available).toBe(true);
    await s.fake.writeLive({ version: '2.0.0' });
    expect((await s.run()).availability.reason).toBe('too-old');
    await s.fake.removeLive();
    expect((await s.run()).availability.reason).toBe('not-live');
  });
  it('never opens a *.key file, and the key and token never appear in a result', async () => {
    const s = await setup();
    opened.length = 0;
    const out = await s.run();
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((p) => p.endsWith('.key'))).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(
      new RegExp(`${FAKE_PEER_TOKEN}|${FAKE_KEY_CONTENT}`),
    );
  });
});

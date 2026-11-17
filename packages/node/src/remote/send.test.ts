import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapSend, sendFrame } from './send.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

async function server(onConnection: (s: Socket) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'c9send-'));
  const path = join(dir, 's.sock');
  const srv: Server = createServer((s) => {
    s.on('error', () => {});
    onConnection(s);
  });
  await new Promise<void>((r) => srv.listen(path, r));
  cleanups.push(async () => {
    srv.close();
    await rm(dir, { recursive: true, force: true });
  });
  return path;
}
class FakeSocket extends EventEmitter {
  bytesWritten = 0;
  destroyed = false;
  ended: string | undefined;
  end(data: string) {
    this.ended = data;
  }
  destroy() {
    this.destroyed = true;
  }
}
const fake = () => {
  const s = new FakeSocket();
  return { s, connect: () => s as unknown as Socket };
};

describe('T022 send', () => {
  it('writes the one line, ends, and never reads a reply', async () => {
    const received: string[] = [];
    let answered = false;
    const path = await server((s) => {
      let data = '';
      s.on('data', (d) => (data += d.toString()));
      s.on('end', () => {
        received.push(data);
        s.write('reply that must be ignored\n');
        answered = true;
      });
    });
    expect(await sendFrame(path, 'one line\n', { timeoutMs: 2000 })).toEqual({
      state: 'sent',
    });
    await vi.waitFor(() => expect(received).toEqual(['one line\n']));
    expect(answered).toBe(true);
  });
  it('is an error code with wrote=false for a missing socket', async () => {
    const out = await sendFrame('/nonexistent/c9view.sock', 'x\n', {
      timeoutMs: 1000,
    });
    expect(out).toMatchObject({ state: 'error', code: 'ENOENT', wrote: false });
  });
  it('a timeout before connect wrote nothing: an ETIMEDOUT error that maps to unreachable', async () => {
    const { s, connect } = fake();
    const result = await sendFrame('/x', 'frame\n', { timeoutMs: 10, connect });
    expect(result).toEqual({ state: 'error', code: 'ETIMEDOUT', wrote: false });
    expect(mapSend(result, () => true)).toEqual({
      state: 'failed',
      reason: 'unreachable',
    });
    expect(s.destroyed).toBe(true);
    expect(s.ended).toBeUndefined();
  });
  it('a timeout after connect is uncertain, destroys the socket and never writes again', async () => {
    const { s, connect } = fake();
    const p = sendFrame('/x', 'frame\n', { timeoutMs: 20, connect });
    s.emit('connect');
    const result = await p;
    expect(result).toEqual({ state: 'uncertain' });
    expect(s.ended).toBe('frame\n');
    expect(s.destroyed).toBe(true);
  });
  it('writes exactly once on connect and settles on finish', async () => {
    const { s, connect } = fake();
    const p = sendFrame('/x', 'frame\n', { timeoutMs: 1000, connect });
    s.emit('connect');
    s.emit('finish');
    expect(await p).toEqual({ state: 'sent' });
    expect(s.ended).toBe('frame\n');
    s.emit('connect');
    s.emit('error', Object.assign(new Error('late'), { code: 'EPIPE' }));
    expect(s.ended).toBe('frame\n');
  });
  it('reports partial-write breakage as an error with wrote=true', async () => {
    const { s, connect } = fake();
    const p = sendFrame('/x', 'frame\n', { timeoutMs: 1000, connect });
    s.emit('connect');
    s.bytesWritten = 3;
    s.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' }));
    expect(await p).toEqual({
      state: 'error',
      code: 'ECONNRESET',
      wrote: true,
    });
  });
  it('treats a close before finish as a broken connection', async () => {
    const { s, connect } = fake();
    const p = sendFrame('/x', 'f\n', { timeoutMs: 1000, connect });
    s.emit('close');
    expect(await p).toEqual({
      state: 'error',
      code: 'ECONNRESET',
      wrote: false,
    });
  });
  it('real server resetting mid-frame never resends and never throws', async () => {
    let connections = 0;
    const path = await server((s) => {
      connections += 1;
      s.once('data', () => s.destroy());
    });
    const out = await sendFrame(path, 'x'.repeat(5000) + '\n', {
      timeoutMs: 1000,
    });
    expect(['sent', 'error']).toContain(out.state);
    expect(connections).toBe(1);
  });
});

describe('T022 error mapping (R7)', () => {
  const err = (code: string, wrote = false) =>
    ({ state: 'error', code, wrote }) as const;
  it.each(['ENOENT', 'ECONNREFUSED'])(
    '%s is session-ended when the process is gone or changed, else unreachable',
    (code) => {
      expect(mapSend(err(code), () => true)).toEqual({
        state: 'failed',
        reason: 'session-ended',
      });
      expect(mapSend(err(code), () => false)).toEqual({
        state: 'failed',
        reason: 'unreachable',
      });
    },
  );
  it.each(['ENOTSOCK', 'EACCES'])(
    '%s is unreachable even when gone',
    (code) => {
      const gone = vi.fn(() => true);
      expect(mapSend(err(code), gone)).toEqual({
        state: 'failed',
        reason: 'unreachable',
      });
      expect(gone).not.toHaveBeenCalled();
    },
  );
  it.each(['EPIPE', 'ECONNRESET'])(
    '%s is uncertain after bytes, else like ENOENT',
    (code) => {
      expect(mapSend(err(code, true), () => true)).toEqual({
        state: 'uncertain',
      });
      expect(mapSend(err(code, false), () => true)).toEqual({
        state: 'failed',
        reason: 'session-ended',
      });
      expect(mapSend(err(code, false), () => false)).toEqual({
        state: 'failed',
        reason: 'unreachable',
      });
    },
  );
  it('unknown codes fail closed and sent/uncertain pass through', () => {
    expect(mapSend(err('EWHATEVER'), () => true)).toEqual({
      state: 'failed',
      reason: 'unreachable',
    });
    expect(mapSend(err('EWHATEVER', true), () => true)).toEqual({
      state: 'uncertain',
    });
    expect(mapSend({ state: 'sent' }, () => true)).toEqual({ state: 'sent' });
    expect(mapSend({ state: 'uncertain' }, () => true)).toEqual({
      state: 'uncertain',
    });
  });
});

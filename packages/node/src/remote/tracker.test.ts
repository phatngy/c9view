import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Tracker,
  type Delivery,
  type Pending,
  type TrackerDeps,
} from './tracker.js';

const roots: string[] = [];
const trackers: Tracker[] = [];
afterEach(async () => {
  for (const t of trackers.splice(0)) t.close();
  vi.useRealTimers();
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
const MSG = '11111111-1111-4111-8111-111111111111';
const peer = (
  kind: 'user' | 'queued',
  msgId: string,
  timestamp?: string,
  name = 'c9view',
) => {
  const origin = {
    kind: 'peer',
    from: 'uds:/dev/null/c9view',
    name,
    msg_id: msgId,
  };
  return JSON.stringify(
    kind === 'user'
      ? { type: 'user', timestamp, message: { content: 'w' }, origin }
      : {
          type: 'attachment',
          timestamp,
          attachment: { type: 'queued_command', prompt: 'p', origin },
        },
  );
};
async function setup(initial = '', deps: Partial<TrackerDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'c9trk-'));
  roots.push(dir);
  const file = join(dir, 't.jsonl');
  await writeFile(file, initial);
  const delivered: [Pending, Delivery][] = [];
  const notSeen: Pending[] = [];
  const has = vi.fn(() => true);
  const tracker = new Tracker({
    has,
    onDelivered: (p, d) => delivered.push([p, d]),
    onNotSeen: (p) => notSeen.push(p),
    notSeenMs: 100000,
    pollMs: 100000,
    ...deps,
  });
  trackers.push(tracker);
  const pending = (
    offset = Buffer.byteLength(initial),
    f: string | undefined = file,
  ): Pending => ({
    msgId: MSG,
    operation: 'remote',
    clientRequestId: 'r1',
    projectId: 'p',
    sessionId: 's',
    file: f,
    offset,
  });
  return { file, tracker, delivered, notSeen, has, pending };
}

describe('T037 tracker', () => {
  it('matches an idle user record by origin.msg_id as new-turn with the record timestamp', async () => {
    const t = await setup('old line\n');
    t.tracker.track(t.pending());
    await appendFile(
      t.file,
      peer('user', MSG, '2026-11-17T10:00:00.000Z') + '\n',
    );
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(1);
    expect(t.delivered[0]![1]).toEqual({
      turn: 'new-turn',
      deliveredAt: '2026-11-17T10:00:00.000Z',
    });
    expect(t.tracker.size).toBe(0);
  });
  it('matches a queued_command attachment as next-step', async () => {
    const t = await setup();
    t.tracker.track(t.pending());
    await appendFile(
      t.file,
      peer('queued', MSG, '2026-11-17T10:00:05Z') + '\n',
    );
    await t.tracker.tick();
    expect(t.delivered[0]![1]).toEqual({
      turn: 'next-step',
      deliveredAt: '2026-11-17T10:00:05.000Z',
    });
  });
  it('omits deliveredAt when the record has no valid timestamp', async () => {
    const t = await setup();
    t.tracker.track(t.pending());
    await appendFile(t.file, peer('user', MSG, 'nonsense') + '\n');
    await t.tracker.tick();
    expect(t.delivered[0]![1]).toEqual({ turn: 'new-turn' });
  });
  it('ignores unrelated ids, queue-operation records and non-peer origins', async () => {
    const t = await setup();
    t.tracker.track(t.pending());
    await appendFile(
      t.file,
      [
        peer('user', '22222222-2222-4222-8222-222222222222'),
        JSON.stringify({
          type: 'queue-operation',
          operation: 'enqueue',
          content: `x ${MSG}`,
        }),
        JSON.stringify({
          type: 'user',
          origin: { kind: 'human', msg_id: MSG },
          message: { content: 'x' },
        }),
        JSON.stringify({ type: 'assistant', text: MSG }),
        'garbage ' + MSG,
      ].join('\n') + '\n',
    );
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(0);
    expect(t.tracker.size).toBe(1);
  });
  it('derives the turn from the record type, not the live status', async () => {
    const t = await setup();
    t.tracker.track(t.pending());
    await appendFile(t.file, peer('queued', MSG) + '\n');
    await t.tracker.tick();
    expect(t.delivered[0]![1].turn).toBe('next-step');
  });
  it('reads from the send-time offset only, never the start', async () => {
    const before = peer('user', MSG, '2026-01-01T00:00:00Z') + '\n';
    const t = await setup(before);
    t.tracker.track(t.pending());
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(0);
    // The offset advanced over new complete lines only.
    await appendFile(t.file, 'next\n');
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(0);
  });
  it('keeps a partial line (and a split UTF-8 character) until it is complete', async () => {
    const t = await setup();
    t.tracker.track(t.pending());
    const line =
      peer('user', MSG, '2026-11-17T10:00:00Z').replace('"w"', '"日本"') + '\n';
    const bytes = Buffer.from(line);
    const cut = bytes.indexOf(Buffer.from('日')) + 1;
    await appendFile(t.file, bytes.subarray(0, cut));
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(0);
    await appendFile(t.file, bytes.subarray(cut));
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(1);
  });
  it('delivers once even with duplicate events and ticks', async () => {
    const events: ((e: { event: string; data: unknown }) => void)[] = [];
    const t = await setup('', { subscribe: (l) => (events.push(l), () => {}) });
    t.tracker.track(t.pending());
    await appendFile(t.file, peer('user', MSG) + '\n');
    for (let i = 0; i < 3; i++)
      events[0]!({
        event: 'session',
        data: { projectId: 'p', sessionId: 's' },
      });
    await Promise.all([t.tracker.tick(), t.tracker.tick()]);
    await vi.waitFor(() => expect(t.delivered).toHaveLength(1));
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(1);
  });
  it('a session event for another session or another event type reads nothing', async () => {
    const events: ((e: { event: string; data: unknown }) => void)[] = [];
    const t = await setup('', { subscribe: (l) => (events.push(l), () => {}) });
    t.tracker.track(t.pending());
    await appendFile(t.file, peer('user', MSG) + '\n');
    events[0]!({
      event: 'session',
      data: { projectId: 'p', sessionId: 'other' },
    });
    events[0]!({ event: 'status', data: { projectId: 'p', sessionId: 's' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.delivered).toHaveLength(0);
    events[0]!({ event: 'session', data: { projectId: 'p', sessionId: 's' } });
    await vi.waitFor(() => expect(t.delivered).toHaveLength(1));
  });
  it('the fallback timer finds a record without any event', async () => {
    const t = await setup('', { pollMs: 10 });
    t.tracker.track(t.pending());
    await appendFile(t.file, peer('user', MSG) + '\n');
    await vi.waitFor(() => expect(t.delivered).toHaveLength(1));
  });
  it('reports not-seen after the time, keeps tracking, and a late release still delivers (same msg_id)', async () => {
    const t = await setup('', { notSeenMs: 20 });
    t.tracker.track(t.pending());
    await vi.waitFor(() => expect(t.notSeen).toHaveLength(1));
    expect(t.tracker.size).toBe(1);
    await appendFile(t.file, peer('user', MSG, '2026-11-17T11:00:00Z') + '\n');
    await t.tracker.tick();
    expect(t.delivered[0]![1].deliveredAt).toBe('2026-11-17T11:00:00.000Z');
    expect(t.notSeen).toHaveLength(1);
  });
  it('drops the entry when the receipt is gone, and stops its timers', async () => {
    const t = await setup('', { notSeenMs: 20 });
    t.tracker.track(t.pending());
    t.has.mockReturnValue(false);
    await t.tracker.tick();
    expect(t.tracker.size).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(t.notSeen).toHaveLength(0);
    await appendFile(t.file, peer('user', MSG) + '\n');
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(0);
  });
  it('an unresolvable transcript stays sent, then becomes not-seen, without an error', async () => {
    const t = await setup('', { notSeenMs: 20 });
    t.tracker.track(t.pending(0, undefined));
    await t.tracker.tick();
    await vi.waitFor(() => expect(t.notSeen).toHaveLength(1));
    const missing = await setup();
    missing.tracker.track(missing.pending(0, '/nonexistent/c9view/t.jsonl'));
    await expect(missing.tracker.tick()).resolves.toBeDefined();
  });
  it('a transcript created after the send is read from byte 0', async () => {
    const t = await setup();
    await rm(t.file);
    t.tracker.track(t.pending(0));
    await t.tracker.tick();
    await writeFile(t.file, peer('user', MSG) + '\n');
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(1);
  });
  it('a full 8 MiB window with no newline is skipped, so the entry does not stall', async () => {
    const t = await setup();
    t.tracker.track(t.pending(0));
    await appendFile(t.file, Buffer.alloc(8 * 1024 * 1024, 0x78));
    await t.tracker.tick();
    await appendFile(t.file, '\n' + peer('user', MSG) + '\n');
    await t.tracker.tick();
    expect(t.delivered).toHaveLength(1);
  });
  it('close stops everything and keeps no text', async () => {
    const t = await setup('', { notSeenMs: 20 });
    t.tracker.track(t.pending());
    t.tracker.close();
    await new Promise((r) => setTimeout(r, 40));
    expect(t.notSeen).toHaveLength(0);
    expect(JSON.stringify(t.pending())).not.toMatch(/text|prompt|body/i);
  });
});

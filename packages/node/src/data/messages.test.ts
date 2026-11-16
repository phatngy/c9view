import { describe, expect, it } from 'vitest';
import { parseRecord } from '@c9view/core';
import { messages } from './messages.js';

const self = { pid: 4242, procStart: '1000' };
const C9 = 'uds:/dev/null/c9view';
const attribution = "Sent by this session's owner from c9view.";
const wrapper = `Another Claude session sent a message:\n<cross-session-message from="${C9}" from-name="c9view">\n${attribution}\n\nhello\n</cross-session-message>`;

function origin(extra: Record<string, unknown> = {}) {
  return {
    kind: 'peer',
    from: C9,
    name: 'c9view',
    msg_id: '11111111-0000-4000-8000-000000000001',
    verifiedPeerPid: 4242,
    verifiedPeerProcStart: '1000',
    body: `${attribution}\n\nhello`,
    ...extra,
  };
}
const user = (uuid: string, content: unknown, extra = {}) =>
  parseRecord({
    type: 'user',
    uuid,
    timestamp: '2026-11-16T10:00:00.000Z',
    message: { role: 'user', content },
    ...extra,
  });
const queued = (uuid: string, o: unknown, prompt = wrapper) =>
  parseRecord({
    type: 'attachment',
    uuid,
    timestamp: '2026-11-16T10:00:02.000Z',
    isMeta: true,
    attachment: { type: 'queued_command', prompt, origin: o },
  });
const text = (m: { blocks: { type: string }[] }) =>
  m.blocks.map((b) => (b as { text?: string }).text).join('');

describe('messages with peer records', () => {
  it('includes queued peer messages in order with the record uuid', () => {
    const result = messages(
      [
        user('u1', 'typed'),
        queued('q1', origin()),
        user('u2', wrapper, { isMeta: true, origin: origin() }),
      ],
      self,
    );
    expect(result.map((m) => m.uuid)).toEqual(['u1', 'q1', 'u2']);
    expect(result[1]).toMatchObject({
      role: 'user',
      isMeta: true,
      timestamp: '2026-11-16T10:00:02.000Z',
      usage: null,
      model: null,
    });
  });

  it('labels c9view with the body minus the attribution line', () => {
    const [idle, mid] = messages(
      [
        user('u2', wrapper, { isMeta: true, origin: origin() }),
        queued('q1', origin()),
      ],
      self,
    );
    for (const m of [idle, mid]) {
      expect(m?.sentFrom).toBe('c9view');
      expect(text(m!)).toBe('hello');
    }
  });

  it("keeps ordinary peers unlabelled-by-c9view and shows today's content", () => {
    const other = {
      kind: 'peer',
      from: 'uds:/x/a.sock',
      name: 'a-8c',
      body: 'PING',
    };
    const [idle, mid] = messages(
      [
        user('u1', wrapper, { isMeta: true, origin: other }),
        queued('q1', other),
      ],
      self,
    );
    expect(idle).toMatchObject({ sentFrom: 'peer' });
    expect(idle?.sentFromVerified).toBeUndefined();
    expect(text(idle!)).toBe(wrapper);
    expect(mid).toMatchObject({ sentFrom: 'peer' });
    expect(text(mid!)).toBe(wrapper);
  });

  it('a record missing from or name is an ordinary peer', () => {
    const [a, b] = messages(
      [
        user('u1', wrapper, {
          isMeta: true,
          origin: origin({ name: undefined }),
        }),
        queued('q1', origin({ from: undefined })),
      ],
      self,
    );
    expect(a?.sentFrom).toBe('peer');
    expect(b?.sentFrom).toBe('peer');
    expect(text(a!)).toBe(wrapper);
  });

  it('shows the body exactly and still redacts secrets', () => {
    const secret = `sk-ant-api03-${'a'.repeat(40)}`;
    const body = `${attribution}\n\nkey ${secret}\n  indented <b>raw</b>`;
    const [m] = messages([queued('q1', origin({ body }))], self);
    expect(text(m!)).not.toContain(secret);
    expect(text(m!)).toContain('indented <b>raw</b>');
  });

  it.each([
    [
      'matching',
      { verifiedPeerPid: 4242, verifiedPeerProcStart: '1000' },
      true,
    ],
    [
      'other pid',
      { verifiedPeerPid: 4243, verifiedPeerProcStart: '1000' },
      false,
    ],
    [
      'other start',
      { verifiedPeerPid: 4242, verifiedPeerProcStart: '1001' },
      false,
    ],
    ['no pid', { verifiedPeerPid: undefined }, false],
    ['no start', { verifiedPeerProcStart: undefined }, false],
  ])('sentFromVerified with %s identity', (_n, extra, expected) => {
    const [a, b] = messages(
      [
        user('u1', wrapper, { isMeta: true, origin: origin(extra) }),
        queued('q1', origin(extra)),
      ],
      self,
    );
    expect(a?.sentFromVerified).toBe(expected);
    expect(b?.sentFromVerified).toBe(expected);
  });

  it('is not verified when the node identity is unreadable', () => {
    const [m] = messages([queued('q1', origin())], null);
    expect(m?.sentFrom).toBe('c9view');
    expect(m?.sentFromVerified).toBe(false);
  });

  it('skips a queued peer record whose prompt is not a string', () => {
    const result = messages([queued('q1', origin({ body: undefined }), 5 as unknown as string)], self);
    expect(result).toEqual([]);
  });

  it('shows a c9view user record without origin.body from its own content', () => {
    const [m] = messages(
      [user('u1', wrapper, { isMeta: true, origin: origin({ body: undefined }) })],
      self,
    );
    expect(m?.sentFrom).toBe('c9view');
    expect(text(m!)).toBe(wrapper);
  });

  it('leaves terminal-typed messages unchanged', () => {
    const result = messages(
      [
        user('u1', 'typed'),
        user('u2', 'typed too', { origin: { kind: 'human' } }),
        queued('q1', { kind: 'human' }),
        parseRecord({
          type: 'attachment',
          uuid: 'a2',
          attachment: { type: 'other' },
        }),
      ],
      self,
    );
    expect(result.map((m) => m.uuid)).toEqual(['u1', 'u2']);
    for (const m of result) {
      expect('sentFrom' in m).toBe(false);
      expect('sentFromVerified' in m).toBe(false);
    }
  });
});

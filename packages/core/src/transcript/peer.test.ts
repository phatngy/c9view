import { describe, expect, it } from 'vitest';
import { parseRecord } from './schemas.js';
import {
  ATTRIBUTION_LINE,
  C9VIEW_FROM,
  C9VIEW_NAME,
  readPeerMessage,
} from './peer.js';

const wrapper = `<cross-session-message from="${C9VIEW_FROM}" from-name="c9view">\nbody\n</cross-session-message>`;
const c9origin = {
  kind: 'peer',
  from: C9VIEW_FROM,
  name: C9VIEW_NAME,
  msg_id: '11111111-0000-4000-8000-000000000001',
  verifiedPeerPid: 4242,
  verifiedPeerProcStart: '1000',
  body: `${ATTRIBUTION_LINE}\n\nReply OK only`,
};
function idle(origin?: unknown, content: unknown = wrapper) {
  return parseRecord({
    type: 'user',
    isMeta: true,
    uuid: 'u1',
    ...(origin === undefined ? {} : { origin }),
    message: { role: 'user', content },
  });
}
function queued(origin?: unknown, prompt: unknown = 'queued prompt') {
  return parseRecord({
    type: 'attachment',
    uuid: 'a1',
    attachment: {
      type: 'queued_command',
      prompt,
      ...(origin === undefined ? {} : { origin }),
    },
  });
}

describe('readPeerMessage', () => {
  it('recognises c9view in an idle user record and strips the attribution', () => {
    expect(readPeerMessage(idle(c9origin))).toEqual({
      fromC9view: true,
      text: 'Reply OK only',
      verifiedPeerPid: 4242,
      verifiedPeerProcStart: '1000',
    });
  });

  it('recognises c9view in a mid-turn queued_command record', () => {
    expect(readPeerMessage(queued(c9origin))).toMatchObject({
      fromC9view: true,
      text: 'Reply OK only',
    });
  });

  it('keeps the whole body when there is no attribution line', () => {
    const origin = { ...c9origin, body: 'line one\nline two' };
    expect(readPeerMessage(idle(origin))?.text).toBe('line one\nline two');
  });

  it('keeps the attribution line when it is not the first line', () => {
    const body = `hi\n${ATTRIBUTION_LINE}\n\nthere`;
    expect(readPeerMessage(idle({ ...c9origin, body }))?.text).toBe(body);
  });

  it('removes only the exact attribution line', () => {
    const near = `${ATTRIBUTION_LINE} extra`;
    const origin = { ...c9origin, body: `${near}\n\nhi` };
    expect(readPeerMessage(idle(origin))?.text).toBe(`${near}\n\nhi`);
  });

  it('treats other peers as ordinary peers with their own content', () => {
    const origin = {
      kind: 'peer',
      from: 'uds:/x/a.sock',
      name: 'a-8c',
      body: 'PING',
    };
    expect(readPeerMessage(idle(origin))).toMatchObject({
      fromC9view: false,
      text: null,
    });
    expect(readPeerMessage(queued(origin))).toMatchObject({
      fromC9view: false,
      text: 'queued prompt',
    });
  });

  it.each([
    ['from', { ...c9origin, from: undefined }],
    ['name', { ...c9origin, name: undefined }],
    ['both', { kind: 'peer', body: c9origin.body }],
    ['a wrong from', { ...c9origin, from: 'uds:/tmp/fake' }],
    ['a wrong name', { ...c9origin, name: 'someone' }],
  ])(
    'a peer record with %s missing or wrong is an ordinary peer',
    (_n, origin) => {
      for (const record of [idle(origin), queued(origin)]) {
        const peer = readPeerMessage(record);
        expect(peer).not.toBeNull();
        expect(peer?.fromC9view).toBe(false);
      }
    },
  );

  it('does not use the wrapper content as a fallback', () => {
    const origin = { kind: 'peer', verifiedPeerPid: 1 };
    expect(readPeerMessage(idle(origin, wrapper))?.fromC9view).toBe(false);
  });

  it('ignores human and origin-less records', () => {
    expect(readPeerMessage(idle({ kind: 'human' }, 'hi'))).toBeNull();
    expect(readPeerMessage(idle(undefined, 'hi'))).toBeNull();
    expect(readPeerMessage(queued({ kind: 'human' }))).toBeNull();
    expect(readPeerMessage(queued())).toBeNull();
  });

  it('ignores other attachment types and other record types', () => {
    expect(
      readPeerMessage(
        parseRecord({
          type: 'attachment',
          attachment: { type: 'hook_success', origin: c9origin },
        }),
      ),
    ).toBeNull();
    expect(
      readPeerMessage(parseRecord({ type: 'system', origin: c9origin })),
    ).toBeNull();
    expect(readPeerMessage(parseRecord(42))).toBeNull();
  });

  it('tolerates malformed and unknown fields', () => {
    const origin = {
      kind: 'peer',
      from: 7,
      name: C9VIEW_NAME,
      verifiedPeerPid: 'abc',
      verifiedPeerProcStart: 5,
      body: ['x'],
      extra: { deep: true },
    };
    expect(readPeerMessage(idle(origin))).toEqual({
      fromC9view: false,
      text: null,
    });
    expect(readPeerMessage(idle('nonsense'))).toBeNull();
    expect(readPeerMessage(queued(origin, 5))).toEqual({
      fromC9view: false,
      text: null,
    });
  });

  it('omits verification fields when absent', () => {
    const rest: Record<string, unknown> = { ...c9origin };
    delete rest.verifiedPeerPid;
    delete rest.verifiedPeerProcStart;
    const peer = readPeerMessage(idle(rest));
    expect(peer?.fromC9view).toBe(true);
    expect(peer?.verifiedPeerPid).toBeUndefined();
    expect(peer?.verifiedPeerProcStart).toBeUndefined();
  });
});

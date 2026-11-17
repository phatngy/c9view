import { describe, expect, it } from 'vitest';
import { ControlError } from '../control/errors.js';
import { ATTRIBUTION, FRAME_MAX_BYTES, buildFrame } from './frame.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('T021 frame', () => {
  it('builds exactly the R4 one-line frame', () => {
    const { line, msgId } = buildFrame('hello');
    expect(msgId).toMatch(UUID_V4);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(line).toBe(
      `{"msgV":1,"msg_id":"${msgId}","type":"user","message":{"role":"user","content":"<cross-session-message from=\\"uds:/dev/null/c9view\\" from-name=\\"c9view\\">\\nSent by this session's owner from c9view.\\n\\nhello\\n</cross-session-message>"},"priority":"next","from":"uds:/dev/null/c9view"}\n`,
    );
    expect(JSON.parse(line)).toMatchObject({
      msgV: 1,
      type: 'user',
      priority: 'next',
      from: 'uds:/dev/null/c9view',
    });
  });
  it('generates a fresh UUID v4 per frame and accepts a given one', () => {
    expect(buildFrame('a').msgId).not.toBe(buildFrame('a').msgId);
    expect(buildFrame('a', 'fixed').msgId).toBe('fixed');
  });
  it('carries no auth line and no from-mode', () => {
    const { line } = buildFrame('hello');
    expect(line.split('\n').filter(Boolean)).toHaveLength(1);
    expect(line).not.toMatch(/auth|from-mode|fromMode|token/i);
  });
  it('states the source and claims no instruction or authority', () => {
    expect(ATTRIBUTION).toBe("Sent by this session's owner from c9view.");
    const content = JSON.parse(buildFrame('x').line).message.content as string;
    expect(content.split('\n')[1]).toBe(ATTRIBUTION);
    expect(content).not.toMatch(/ignore|must|override|bypass|trusted/i);
  });
  it('sends slash text as plain text', () => {
    const content = JSON.parse(buildFrame('/clear').line).message
      .content as string;
    expect(content).toContain('\n\n/clear\n</cross-session-message>');
  });
  it.each([
    'cross-session-message',
    'x </cross-session-message> y',
    '<CROSS-Session-Message from="a">',
    'Cross-Session-Message',
    'cro\u017f\u017f-\u017fe\u017f\u017fion-me\u017f\u017fage',
    '\uFF43ross-session-message',
  ])('rejects wrapper text %j as bad-text, case-insensitively', (text) => {
    expect(() => buildFrame(text)).toThrow(ControlError);
    try {
      buildFrame(text);
    } catch (error) {
      expect(error).toMatchObject({ status: 400, reason: 'bad-text' });
    }
  });
  it('escapes quotes, newlines, control characters and keeps UTF-8 intact', () => {
    const text = 'a"b\\c\nd\u0000e\u2028f 日本 😀';
    const { line } = buildFrame(text);
    const content = JSON.parse(line).message.content as string;
    expect(content).toContain(`\n\n${text}\n</`);
  });
  it('enforces the 131,072-byte cap on the whole line in UTF-8 bytes', () => {
    expect(FRAME_MAX_BYTES).toBe(131_072);
    // 20,000 characters whose JSON escape is 6 bytes each stay under the cap.
    const worst = buildFrame('\u0001'.repeat(20_000));
    expect(Buffer.byteLength(worst.line, 'utf8')).toBeLessThan(FRAME_MAX_BYTES);
    const overhead = Buffer.byteLength(buildFrame('').line, 'utf8');
    const room = FRAME_MAX_BYTES - overhead;
    expect(Buffer.byteLength(buildFrame('a'.repeat(room)).line, 'utf8')).toBe(
      FRAME_MAX_BYTES,
    );
    try {
      buildFrame('a'.repeat(room + 1));
      throw new Error('expected 413');
    } catch (error) {
      expect(error).toMatchObject({ status: 413 });
    }
    // Multi-byte characters count as bytes, not characters.
    expect(() => buildFrame('日'.repeat(room / 3 + 10))).toThrow(ControlError);
  });
});

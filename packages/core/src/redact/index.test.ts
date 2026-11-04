import { describe, expect, it } from 'vitest';
import { redactText, redactValue } from './index.js';

describe('secret redaction', () => {
  it.each([
    ['anthropic', `sk-ant-api03-${'x'.repeat(40)}`],
    ['openai', `sk-proj-${'x'.repeat(40)}`],
    ['github', `ghp_${'a'.repeat(36)}`],
    ['github', `github_pat_${'a'.repeat(40)}`],
    ['aws', `AKIA${'A'.repeat(16)}`],
    ['google', `AIza${'a'.repeat(35)}`],
    ['google', 'ya29.synthetic-example'],
    ['slack', 'xoxb-1234567890-abcdefghij'],
    ['stripe', 'sk_live_abcdefghijklmnop'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c3ludGhldGlj'],
    [
      'private-key',
      '-----BEGIN RSA PRIVATE KEY-----\nsynthetic\n-----END RSA PRIVATE KEY-----',
    ],
  ])('masks %s patterns', (kind, input) => {
    expect(redactText(`before ${input} after`)).toBe(
      `before «redacted:${kind}» after`,
    );
  });
  it('masks assignments, bearer auth and URL credentials', () => {
    const text =
      'password="synthetic pass" access_token=synthetic123456 secret: synthetic123456 api_key=synthetic123456 https://user:pass@example.test/x Bearer synthetic-auth';
    const output = redactText(text);
    expect(output).not.toContain('synthetic');
    expect(output).toContain(
      'https://«redacted:url-credentials»@example.test/x',
    );
    expect(output).toContain('Bearer «redacted:bearer»');
    expect(redactText(output)).toBe(output);
  });
  it('preserves ordinary code, UUIDs, SHAs and base64-looking session key paths', () => {
    const input =
      'const count = 12;\n550e8400-e29b-41d4-a716-446655440000\n' +
      'c8e415a06757ce22dbdffbc186d5637634c8f7a4\nsessions/abCDEF0123456789_+xyz==.key\n' +
      'https://example.test/path git@github.com:org/repo';
    expect(redactText(input)).toBe(input);
  });
  it('masks sensitive keys and every nested env value without mutating inputs', () => {
    const input = {
      model: 'test',
      nested: {
        accessToken: 'example',
        API_KEY: 'example',
        cookie: 'example',
        private: 42,
      },
      env: { PUBLIC: 'example', NESTED: { count: 2 }, LIST: ['example'] },
    };
    expect(redactValue(input)).toEqual({
      model: 'test',
      nested: {
        accessToken: '«redacted:key»',
        API_KEY: '«redacted:key»',
        cookie: '«redacted:key»',
        private: 42,
      },
      env: {
        PUBLIC: '«redacted:env»',
        NESTED: { count: '«redacted:env»' },
        LIST: ['«redacted:env»'],
      },
    });
    expect(input.env.PUBLIC).toBe('example');
  });
  it('handles cycles and shared references', () => {
    const object: Record<string, unknown> = { safe: 'ordinary' };
    object.self = object;
    expect(redactValue(object)).toEqual({
      safe: 'ordinary',
      self: '«redacted:cycle»',
    });
    expect(redactValue([object, object])).toHaveLength(2);
  });
});

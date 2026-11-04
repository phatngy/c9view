import { describe, expect, it } from 'vitest';
import { redactText, redactValue } from './index.js';

describe('security review regressions', () => {
  it.each(['Basic', 'Bearer', 'Token', 'Digest'])(
    'keeps %s while masking its credential',
    (scheme) => {
      const input = `Authorization: ${scheme} dXNlcjpwYXNz`;
      expect(redactText(input)).toBe(
        `Authorization: ${scheme} «redacted:${scheme.toLowerCase()}»`,
      );
      expect(redactText(redactText(input))).toBe(redactText(input));
    },
  );
  it.each(['Basic', 'Bearer'])('masks standalone %s credentials', (scheme) => {
    expect(redactText(`${scheme} abc123xyz`)).toBe(
      `${scheme} «redacted:${scheme.toLowerCase()}»`,
    );
  });
  it.each([
    'const token = getToken();',
    'tokens: 5',
    'max_tokens=4096',
    'password: string',
    'const secret: string = x',
    'api_key: process.env.KEY',
    '// token: number',
    'access_token = getAccessToken123();',
    'secret = identifier123;',
    'const secret: MyType123456 = x',
    'api_key: process.env.KEY123456',
    'token="ordinary docs"',
    'password=123456789012',
    'secret=identifier123.field',
    'secret=12345abc',
    'secret="short"',
  ])('preserves code/counts: %s', (input) =>
    expect(redactText(input)).toBe(input),
  );
  it.each([
    'password="a secret phrase"',
    'password=Password123456',
    "api_key='abcdefgh'",
    'secret=abc123456789',
    'access_token: abc123456789',
    'refresh_token=abc123456789',
    'auth_token=abc123456789',
    'api_token=abc123456789',
    'id_token=abc123456789',
  ])('masks literal assignment: %s', (input) => {
    expect(redactText(input)).toContain('«redacted:assignment»');
  });
  it('only masks string sensitive-key values, preserving token counts and nested structures', () => {
    expect(
      redactValue({
        token: 'type label',
        tokens: 5,
        max_tokens: 4096,
        output_tokens: '5',
        password: 5,
        secret: { safe: true },
        accessToken: 'short',
        refresh_token: 'short',
        auth_token: 'short',
        api_token: 'short',
        id_token: 'short',
        apiKey: 'short',
      }),
    ).toEqual({
      token: 'type label',
      tokens: 5,
      max_tokens: 4096,
      output_tokens: '5',
      password: 5,
      secret: { safe: true },
      accessToken: '«redacted:key»',
      refresh_token: '«redacted:key»',
      auth_token: '«redacted:key»',
      api_token: '«redacted:key»',
      id_token: '«redacted:key»',
      apiKey: '«redacted:key»',
    });
  });
  it.each([
    '--api-key abc123xyz',
    '--api_key=abc123xyz',
    '-token abc123xyz',
    '--secret=abc123xyz',
    '--password abc123xyz',
    '--auth abc123xyz',
    '--api-key="a secret value"',
  ])('masks command flags: %s', (input) => {
    const output = redactText(`x ${input}`);
    expect(output).not.toContain('abc123xyz');
    expect(output).not.toContain('a secret value');
    expect(output).toContain('«redacted:flag»');
    expect(redactText(output)).toBe(output);
  });
  it.each([
    'key',
    'api_key',
    'apikey',
    'token',
    'sig',
    'signature',
    'auth',
    'access_token',
    'password',
  ])('masks URL %s params and userinfo', (key) => {
    const output = redactText(
      `https://u:p@example.test/p?${key}=abc123xyz&safe=1#part`,
    );
    expect(output).toBe(
      `https://«redacted:url-credentials»@example.test/p?${key}=«redacted:query»&safe=1#part`,
    );
    expect(redactText(output)).toBe(output);
  });
  it('keeps specific secret formats unconditional in code and count keys', () => {
    const secret = `ghp_${'a'.repeat(36)}`;
    expect(redactText(`const token = "${secret}";`)).not.toContain(secret);
    expect(redactValue({ max_tokens: secret })).toEqual({
      max_tokens: '«redacted:github»',
    });
  });
});

it('masks complete Digest parameter lists, including quoted fields', () => {
  const output = redactText(
    'Authorization: Digest username="synthetic-user", realm="private-realm", nonce="abc123xyz", response="private-response"',
  );
  expect(output).toBe('Authorization: Digest «redacted:digest»');
  expect(redactText(output)).toBe(output);
});
it('masks additional token keys while preserving plural count keys', () => {
  expect(
    redactValue({
      session_token: 'short',
      csrfToken: 'short',
      credentials: 'short',
      secrets: 'short',
      session_tokens: 4,
    }),
  ).toEqual({
    session_token: '«redacted:key»',
    csrfToken: '«redacted:key»',
    credentials: '«redacted:key»',
    secrets: '«redacted:key»',
    session_tokens: 4,
  });
});

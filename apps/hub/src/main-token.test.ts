import { describe, expect, it } from 'vitest';
import { requireRecoverableToken } from './main.js';

describe('requireRecoverableToken', () => {
  it('refuses a generated token when there is no terminal to show it', () => {
    expect(() => requireRecoverableToken('token', false, false)).toThrow(
      /set C9VIEW_TOKEN/,
    );
  });
  it('allows a set token, a terminal, or other auth modes', () => {
    expect(() => requireRecoverableToken('token', true, false)).not.toThrow();
    expect(() => requireRecoverableToken('token', false, true)).not.toThrow();
    expect(() =>
      requireRecoverableToken('password', false, false),
    ).not.toThrow();
    expect(() => requireRecoverableToken('none', false, false)).not.toThrow();
  });
});

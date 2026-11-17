import { describe, expect, it } from 'vitest';
import { REMOTE_MIN_VERSION, meetsMinimum, parseVersion } from './version.js';

describe('T031 minimum version', () => {
  it('keeps the spike-verified minimum', () => {
    expect(REMOTE_MIN_VERSION).toBe('2.1.318');
  });
  it('compares numerically, not as text', () => {
    expect(meetsMinimum('2.1.318')).toBe(true);
    expect(meetsMinimum('2.1.325')).toBe(true);
    expect(meetsMinimum('2.2.0')).toBe(true);
    expect(meetsMinimum('3.0.0')).toBe(true);
    expect(meetsMinimum('2.1.1000')).toBe(true);
    expect(meetsMinimum('2.10.0')).toBe(true);
    expect(meetsMinimum('2.1.317')).toBe(false);
    expect(meetsMinimum('2.0.999')).toBe(false);
    expect(meetsMinimum('1.99.99')).toBe(false);
    expect(meetsMinimum('2.1.99')).toBe(false);
  });
  it.each([
    undefined,
    null,
    7,
    '',
    '2.1',
    '2.1.x',
    'v2.1.325',
    '2.1.325-beta.1',
    '2.1.325+build5',
    '2.1.325 (Claude Code)',
    ' 2.1.325',
    '2.1.325\n',
    '2.1.3.25',
    '-2.1.325',
  ])('fails closed on %j', (value) => {
    expect(parseVersion(value)).toBeNull();
    expect(meetsMinimum(value)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('VERSION', () => {
  it('exports the current package version', () => {
    expect(VERSION).toBe('0.0.0');
  });
});

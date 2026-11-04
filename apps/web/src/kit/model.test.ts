import { describe, expect, it } from 'vitest';
import { modelFamily, modelLabel } from './model.js';
describe('model names', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-3-5-haiku-20241022', 'Haiku 3.5'],
    ['claude-sonnet-4-6', 'Sonnet 4.6'],
    ['fable-1', 'Fable 1'],
    ['custom', 'custom'],
    ['claude-opus-latest', 'claude-opus-latest'],
  ])('labels %s', (input, expected) => {
    expect(modelLabel(input)).toBe(expected);
  });
  it('recognizes family substrings case insensitively', () => {
    expect(modelFamily('vendor/CLAUDE-OPUS-5')).toBe('opus');
    expect(modelFamily('custom')).toBe('other');
  });
});

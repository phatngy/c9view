import { expect, it } from 'vitest';
import { claimLocation } from './inflight.js';

it('T106 refuses the same location, an ancestor and a descendant of a claim', () => {
  const release = claimLocation('/w/a/b');
  expect(() => claimLocation('/w/a/b')).toThrow(/already using/);
  expect(() => claimLocation('/w/a')).toThrow(/already using/);
  expect(() => claimLocation('/w/a/b/c')).toThrow(/already using/);
  release();
});
it('T106 allows a sibling, and releasing frees the location', () => {
  const release = claimLocation('/w/a/b');
  const sibling = claimLocation('/w/a/bc');
  sibling();
  expect(() => claimLocation('/w/a')).toThrow(/already using/);
  release();
  const again = claimLocation('/w/a');
  expect(() => claimLocation('/w/a/b')).toThrow(/already using/);
  again();
  claimLocation('/w/a/b')();
});

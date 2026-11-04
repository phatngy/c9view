import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resetConnection, setConnection, useLiveConnection } from './state.js';

beforeEach(() => {
  vi.useFakeTimers();
  resetConnection();
});
afterEach(() => {
  resetConnection();
  vi.useRealTimers();
});

const polling = () =>
  renderHook(() => useLiveConnection()).result.current.polling;

it('keeps the polling fallback on across retry flips after it engages', () => {
  setConnection('live');
  expect(polling()).toBe(false);
  setConnection('offline');
  vi.advanceTimersByTime(10_000);
  expect(polling()).toBe(true);
  for (let i = 0; i < 5; i++) {
    setConnection('connecting');
    expect(polling()).toBe(true);
    setConnection('offline');
    vi.advanceTimersByTime(8_000);
    expect(polling()).toBe(true);
  }
  setConnection('live');
  expect(polling()).toBe(false);
});

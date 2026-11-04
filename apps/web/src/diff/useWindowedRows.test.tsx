import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useContainerHeight } from './useWindowedRows.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('measures the code container height and falls back to 600 before measurement', async () => {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { value: 320 });
  const container = { current: element };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([], this as unknown as ResizeObserver);
        expect(target).toBe(element);
      }
      disconnect() {}
    },
  );
  const { result } = renderHook(() => useContainerHeight(container));
  await waitFor(() => expect(result.current).toBe(320));
});

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from 'react';

export function useContainerHeight(
  container: RefObject<HTMLElement | null>,
  fallback = 600,
) {
  const [height, setHeight] = useState(fallback);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      if (element.clientHeight > 0) setHeight(element.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  return height;
}

export function useWindowedRows(
  count: number,
  {
    enabled,
    viewportHeight = 600,
    overscan = 40,
  }: { enabled: boolean; viewportHeight?: number; overscan?: number },
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeight, setRowHeight] = useState(24);
  const measured = useRef(false);
  const measureRow = useCallback((node: HTMLElement | null) => {
    if (!measured.current && node?.offsetHeight) {
      measured.current = true;
      setRowHeight(node.offsetHeight);
    }
  }, []);
  const start = enabled
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    : 0;
  const end = enabled
    ? Math.min(
        count,
        Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
      )
    : count;
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);
  const scrollToIndex = useCallback(
    (index: number, element: HTMLElement | null, align = 0.5) => {
      if (!enabled || !element) return;
      const top = Math.max(
        0,
        index * rowHeight - Math.max(0, element.clientHeight || viewportHeight) * align,
      );
      element.scrollTop = top;
      setScrollTop(top);
    },
    [enabled, rowHeight, viewportHeight],
  );
  return {
    start,
    end,
    top: start * rowHeight,
    bottom: Math.max(0, (count - end) * rowHeight),
    rowHeight,
    measureRow,
    onScroll,
    scrollToIndex,
  };
}

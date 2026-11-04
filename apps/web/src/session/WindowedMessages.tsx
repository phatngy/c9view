import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import type { Message } from '@c9view/api';
import { smoothScrollBehavior } from './paging.js';

const NEAR_TOP_THRESHOLD = 400;

const defaultEstimate = () => 220;

function scrollToOffset(node: HTMLElement, top: number) {
  node.scrollTop = top;
  node.dispatchEvent(new Event('scroll'));
}

export function scrollConversationToBottom(
  node: HTMLElement,
  behavior: ScrollBehavior = smoothScrollBehavior(),
) {
  node.dispatchEvent(new Event('conversation-bottom'));
  const top = Math.max(0, node.scrollHeight - node.clientHeight);
  if (behavior === 'smooth' && node.scrollTo) {
    if (
      top - node.scrollTop > node.clientHeight * 2 &&
      node.querySelector(':scope > [aria-hidden="true"]')
    ) {
      // Materialize the tail before animating; estimates are corrected instantly.
      scrollToOffset(node, Math.max(0, top - node.clientHeight * 2));
      requestAnimationFrame(() =>
        node.scrollTo({ top: node.scrollHeight - node.clientHeight, behavior }),
      );
    } else node.scrollTo({ top, behavior });
  } else scrollToOffset(node, top);
}

type Anchor = { key: string; uuid: string; top: number; height: number };

export function WindowedMessages({
  groups,
  enabled,
  target,
  jumpVersion = 0,
  render,
  inline = false,
  onJumpHandled,
  footer,
  header,
  startAtBottom = false,
  onNearTop,
  isFetching = false,
  estimate = defaultEstimate,
}: {
  footer?: ReactNode;
  header?: ReactNode;
  startAtBottom?: boolean;
  onNearTop?: (() => void) | undefined;
  isFetching?: boolean;
  estimate?: (group: Message[]) => number;
  groups: Message[][];
  enabled: boolean;
  target?: string | undefined;
  jumpVersion?: number;
  render: (group: Message[]) => ReactNode;
  inline?: boolean;
  onJumpHandled?: (() => void) | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const headerNode = useRef<HTMLDivElement>(null);
  const pinned = useRef(startAtBottom);
  const ready = useRef(!startAtBottom);
  const anchors = useRef<Anchor[]>([]);
  const measured = useRef(new Map<string, number>());
  const pendingAnchor = useRef<Anchor | undefined>(undefined);
  const pendingCandidates = useRef<Anchor[]>([]);
  const latest = useRef({ target, onNearTop });
  useLayoutEffect(() => {
    latest.current = { target, onNearTop };
  });
  // Mounting with rows also completes the initial load.
  const wasFetching = useRef(true);
  const restoringLayout = useRef(false);
  const inset = () => headerNode.current?.offsetHeight ?? 0;
  const capture = useCallback((node: HTMLElement) => {
    if (!node.clientHeight) return;
    const rect = node.getBoundingClientRect();
    const rows = [...node.querySelectorAll<HTMLElement>('[data-message-row]')];
    const following =
      rect.height > 0
        ? rows.find((row) => row.getBoundingClientRect().top >= rect.bottom)
        : undefined;
    const candidates = rows
      .filter((row) => {
        const bounds = row.getBoundingClientRect();
        return (
          (bounds.bottom > rect.top && bounds.top < rect.bottom) ||
          row === following
        );
      })
      .map((row) => ({
        key: row.dataset.messageRow!,
        uuid:
          row.querySelector<HTMLElement>('[id^="m-"]')?.id.slice(2) ??
          row.dataset.messageRow!,
        top: row.getBoundingClientRect().top - rect.top,
        height: row.getBoundingClientRect().height,
      }));
    if (candidates.length) {
      const eye = document
        .elementFromPoint?.(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        ?.closest<HTMLElement>('[data-message-row]');
      const focus =
        candidates.find(
          (candidate) => candidate.key === eye?.dataset.messageRow,
        ) ??
        candidates.find(
          (candidate) =>
            candidate.top <= rect.height / 2 &&
            candidate.top + candidate.height > rect.height / 2,
        );
      // The row under the reader's eye wins when a partial leading row merges.
      const index = focus ? candidates.indexOf(focus) : -1;
      anchors.current =
        index >= 0
          ? [
              ...candidates.slice(index),
              ...candidates.slice(0, index).reverse(),
            ]
          : candidates;
    }
  }, []);
  const restore = useCallback((node: HTMLElement, anchor: Anchor) => {
    const rows = [...node.querySelectorAll<HTMLElement>('[data-message-row]')];
    const row =
      rows.find((row) => row.dataset.messageRow === anchor.key) ??
      rows.find((row) =>
        [...row.querySelectorAll<HTMLElement>('[id^="m-"]')].some(
          (message) => message.id === `m-${anchor.uuid}`,
        ),
      );
    if (!row) return false;
    scrollToOffset(
      node,
      node.scrollTop +
        row.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        anchor.top,
    );
    return true;
  }, []);
  const restorePending = useCallback(
    (node: HTMLElement) => {
      const rows = [
        ...node.querySelectorAll<HTMLElement>('[data-message-row]'),
      ];
      const surviving = pendingCandidates.current.find((candidate) =>
        rows.some((row) => row.dataset.messageRow === candidate.key),
      );
      if (surviving) pendingAnchor.current = surviving;
      if (pendingAnchor.current) restore(node, pendingAnchor.current);
    },
    [restore],
  );
  const pin = useCallback(
    (node: HTMLElement) => {
      if (
        !inline &&
        pinned.current &&
        !latest.current.target &&
        node.clientHeight > 0
      ) {
        scrollConversationToBottom(node, 'instant');
        if (node.querySelector('[data-message-row]')) ready.current = true;
        return true;
      }
      return false;
    },
    [inline],
  );
  const lastTarget = useRef<string | undefined>(undefined);
  const previousLayout = useRef<{
    keys: string[];
    offsets: number[];
    enabled: boolean;
  } | null>(null);
  const [heights, setHeights] = useState(new Map<string, number>());
  const [viewport, setViewport] = useState({ top: 0, height: 700 });
  const heightOf = useCallback(
    (group: Message[]) => heights.get(group[0]!.uuid) ?? estimate(group),
    [heights, estimate],
  );
  const offsets = useMemo(() => {
    const values = [0];
    for (const group of groups) values.push(values.at(-1)! + heightOf(group));
    return values;
  }, [groups, heightOf]);
  const layout = useRef({ groups, offsets, enabled });
  useLayoutEffect(() => {
    layout.current = { groups, offsets, enabled };
  }, [groups, offsets, enabled]);
  // Effects read the latest measure through a ref, so a new estimate function
  // neither re-observes rows nor restarts an in-flight jump.
  const heightOfRef = useRef(heightOf);
  useLayoutEffect(() => {
    heightOfRef.current = heightOf;
  }, [heightOf]);
  useLayoutEffect(() => {
    const node = container.current;
    const scroller = inline
      ? node?.parentElement?.closest<HTMLElement>('.conversation-window')
      : null;
    if (!node || !scroller) return;
    const update = () =>
      setViewport({
        top: Math.max(
          0,
          scroller.getBoundingClientRect().top -
            node.getBoundingClientRect().top,
        ),
        height: scroller.clientHeight || 700,
      });
    update();
    const jump = (event: Event) =>
      setViewport({
        top: (event as CustomEvent<number>).detail,
        height: scroller.clientHeight || 700,
      });
    node.addEventListener('conversation-jump', jump);
    scroller.addEventListener('scroll', update);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    return () => {
      node.removeEventListener('conversation-jump', jump);
      scroller.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [inline]);
  let start = 0,
    end = groups.length;
  if (enabled) {
    const first = offsets.findIndex((v) => v > viewport.top);
    start = Math.max(0, (first < 0 ? groups.length : first) - 11);
    const last = offsets.findIndex((v) => v > viewport.top + viewport.height);
    end = Math.min(groups.length, (last < 0 ? groups.length : last) + 10);
  }
  useLayoutEffect(() => {
    restoringLayout.current = true;
    const node = inline
      ? container.current?.parentElement?.closest<HTMLElement>(
          '.conversation-window',
        )
      : container.current;
    if (target) {
      pendingAnchor.current = undefined;
      pendingCandidates.current = [];
    }
    const previous = previousLayout.current;
    const prepended = previous && previous.keys[0] !== groups[0]?.[0]?.uuid;
    if (node && !pin(node) && !target) {
      if (prepended && !inline && node.clientHeight > 0) {
        // Prefer a surviving row key before falling back to a merged row's UUID.
        const anchor =
          anchors.current.find((candidate) =>
            groups.some((group) => group[0]!.uuid === candidate.key),
          ) ??
          anchors.current.find((candidate) =>
            groups.some((group) =>
              group.some((m) => m.uuid === candidate.uuid),
            ),
          );
        pendingCandidates.current = [...anchors.current];
        pendingAnchor.current = anchor;
        if (anchor && enabled) {
          const index = groups.findIndex(
            (group) =>
              group[0]!.uuid === anchor.key ||
              group.some((m) => m.uuid === anchor.uuid),
          );
          scrollToOffset(node, inset() + offsets[index]! - anchor.top);
        }
      }
      if (pendingAnchor.current && node.clientHeight > 0) {
        restorePending(node);
      } else if (
        previous &&
        prepended &&
        enabled &&
        (node.clientHeight > 0 || !startAtBottom)
      ) {
        const first = previous.offsets.findIndex(
          (offset) => offset > node.scrollTop - inset(),
        );
        const oldIndex = Math.max(
          0,
          first < 0 ? previous.keys.length - 1 : first - 1,
        );
        for (let index = oldIndex; index < previous.keys.length; index++) {
          const newIndex = groups.findIndex(
            (group) => group[0]!.uuid === previous.keys[index],
          );
          if (newIndex < 0) continue;
          scrollToOffset(
            node,
            node.scrollTop + offsets[newIndex]! - previous.offsets[index]!,
          );
          break;
        }
      }
    }
    // DOM anchoring already accounts for synchronous reflow in this commit.
    // Baseline those sizes so the observer only corrects subsequent resizes.
    if (node && prepended && !enabled && node.clientHeight > 0) {
      node
        .querySelectorAll<HTMLElement>(':scope > [data-message-row]')
        .forEach((row) => {
          measured.current.set(
            row.dataset.messageRow!,
            row.getBoundingClientRect().height,
          );
        });
    }
    previousLayout.current = {
      keys: groups.map((group) => group[0]!.uuid),
      offsets,
      enabled,
    };
    if (node && !inline && node.clientHeight > 0) {
      capture(node);
      // Appends can increase the distance without a native scroll event.
      if (!pinned.current) node.dispatchEvent(new Event('scroll'));
    }
    restoringLayout.current = false;
  }, [
    groups,
    offsets,
    enabled,
    inline,
    target,
    pin,
    restorePending,
    capture,
    start,
    end,
    startAtBottom,
  ]);
  // Run after the prepend layout has restored the reader's anchor.
  useLayoutEffect(() => {
    const finished = wasFetching.current && !isFetching;
    wasFetching.current = isFetching;
    const node = container.current;
    if (
      finished &&
      !inline &&
      node &&
      node.clientHeight > 0 &&
      ready.current &&
      node.scrollTop < NEAR_TOP_THRESHOLD
    )
      latest.current.onNearTop?.();
  }, [isFetching, inline]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node || inline || typeof ResizeObserver === 'undefined') return;
    let wasVisible = node.clientHeight > 0;
    let frame = 0;
    const finish = () => {
      if (pinned.current) pin(node);
    };
    const resetAnchor = () => {
      pendingAnchor.current = undefined;
      pendingCandidates.current = [];
    };
    node.addEventListener('conversation-bottom', resetAnchor);
    node.addEventListener('scrollend', finish);
    const observer = new ResizeObserver(() => {
      const visible = node.clientHeight > 0;
      if (visible && pinned.current) pin(node);
      if (visible && !wasVisible && !latest.current.target) {
        if (!pin(node)) {
          const anchor = anchors.current[0];
          if (anchor) {
            if (layout.current.enabled) {
              const index = layout.current.groups.findIndex(
                (group) =>
                  group[0]!.uuid === anchor.key ||
                  group.some((m) => m.uuid === anchor.uuid),
              );
              if (index >= 0)
                scrollToOffset(
                  node,
                  inset() + layout.current.offsets[index]! - anchor.top,
                );
            }
            restore(node, anchor);
            frame = requestAnimationFrame(() => {
              restore(node, anchor);
              capture(node);
            });
          }
        }
      }
      wasVisible = visible;
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeEventListener('scrollend', finish);
      node.removeEventListener('conversation-bottom', resetAnchor);
      cancelAnimationFrame(frame);
    };
  }, [inline, pin, restore, capture]);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = new Map(heights);
      let changed = false;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const key = element.dataset.messageRow;
        if (!key) continue;
        const height =
          entry.borderBoxSize?.[0]?.blockSize ??
          element.getBoundingClientRect().height;
        if (height <= 0 || heights.get(key) === height) continue;
        const group = groups.find((group) => group[0]!.uuid === key);
        if (!group) continue;
        const wasMeasured = measured.current.has(key);
        const previous = enabled
          ? heightOfRef.current(group)
          : (measured.current.get(key) ?? heightOfRef.current(group));
        measured.current.set(key, height);
        next.set(key, height);
        // Preserve the visible position if an earlier rendered row changes size.
        const scroller = inline
          ? node.parentElement?.closest<HTMLElement>('.conversation-window')
          : node;
        if (
          (enabled || wasMeasured) &&
          scroller &&
          (inline || scroller.clientHeight > 0) &&
          !pinned.current &&
          !pendingAnchor.current &&
          (inline
            ? element.getBoundingClientRect().top + previous <
              scroller.getBoundingClientRect().top
            : element.offsetTop + previous < scroller.scrollTop)
        ) {
          scroller.scrollTop += height - previous;
          scroller.dispatchEvent(new Event('scroll'));
        }
        changed = true;
      }
      if (!changed && !inline && pendingAnchor.current && node.clientHeight > 0)
        restorePending(node);
      if (changed) {
        flushSync(() => setHeights(next));
        if (!inline) {
          if (!pin(node) && pendingAnchor.current && node.clientHeight > 0)
            restorePending(node);
          capture(node);
        }
      }
    });
    node
      .querySelectorAll<HTMLElement>(':scope > [data-message-row]')
      .forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [
    groups,
    start,
    end,
    enabled,
    heights,
    inline,
    pin,
    capture,
    restorePending,
  ]);
  useLayoutEffect(() => {
    if (!target) {
      lastTarget.current = undefined;
      return;
    }
    if (!container.current || lastTarget.current === `${jumpVersion}:${target}`)
      return;
    const index = groups.findIndex((group) =>
      group.some(
        (m) =>
          m.uuid === target ||
          m.blocks.some((b) => b.type === 'tool_use' && b.id === target),
      ),
    );
    if (index < 0) return;
    lastTarget.current = `${jumpVersion}:${target}`;
    const node = container.current;
    const nested =
      !inline &&
      Array.from(node.children).some(
        (row) =>
          (row as HTMLElement).dataset.messageRow ===
            groups[index]?.[0]?.uuid &&
          row.querySelector('.conversation-inline'),
      );
    if (enabled && !nested) {
      let top = 0;
      for (const group of groups.slice(0, index))
        top += heightOfRef.current(group);
      const scroller = inline
        ? node.parentElement?.closest<HTMLElement>('.conversation-window')
        : node;
      if (scroller) {
        const base = inline
          ? node.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop
          : inset();
        scrollToOffset(scroller, base + top);
      }
      if (inline)
        node.dispatchEvent(
          new CustomEvent('conversation-jump', { detail: top }),
        );
    }
    let frame = 0;
    let attempts = 0;
    const correct = () => {
      const element =
        document.getElementById(`m-${target}`) ??
        document.getElementById(`tool-${encodeURIComponent(target)}`);
      if (element) {
        element.scrollIntoView?.({
          block: 'center',
          behavior: smoothScrollBehavior(),
        });
        element.tabIndex = -1;
        element.focus({ preventScroll: true });
        element.classList.remove('message-highlight');
        void element.offsetWidth;
        element.classList.add('message-highlight');
      }
      if (++attempts < 4) frame = requestAnimationFrame(correct);
      else if (element) onJumpHandled?.();
    };
    frame = requestAnimationFrame(correct);
    return () => {
      cancelAnimationFrame(frame);
      if (attempts < 4) lastTarget.current = undefined;
    };
  }, [target, jumpVersion, groups, enabled, inline, onJumpHandled]);
  return (
    <div
      ref={container}
      className={inline ? 'conversation-inline' : 'conversation-window'}
      aria-label="Conversation messages"
      onWheel={() => {
        pendingAnchor.current = undefined;
        pendingCandidates.current = [];
      }}
      onPointerDown={() => {
        pendingAnchor.current = undefined;
        pendingCandidates.current = [];
      }}
      onTouchStart={() => {
        pendingAnchor.current = undefined;
        pendingCandidates.current = [];
      }}
      onKeyDown={() => {
        pendingAnchor.current = undefined;
        pendingCandidates.current = [];
      }}
      onScroll={(e) => {
        if (inline || e.target !== e.currentTarget) return;
        const node = e.currentTarget;
        if (node.clientHeight > 0) {
          const wasPinned = pinned.current;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight <= 80;
          if (startAtBottom && !wasPinned && pinned.current && !target)
            requestAnimationFrame(() => pin(node));
          capture(node);
          if (
            !restoringLayout.current &&
            ready.current &&
            node.scrollTop < NEAR_TOP_THRESHOLD
          )
            onNearTop?.();
        }
        setViewport({
          top: Math.max(0, e.currentTarget.scrollTop - inset()),
          height: e.currentTarget.clientHeight || 700,
        });
      }}
    >
      {header && <div ref={headerNode}>{header}</div>}
      {enabled && <div aria-hidden="true" style={{ height: offsets[start] }} />}
      {groups.slice(start, end).map((group) => (
        <div
          key={group[0]!.uuid}
          data-message-row={group[0]!.uuid}
          className="message-row"
        >
          {render(group)}
        </div>
      ))}
      {enabled && (
        <div
          aria-hidden="true"
          style={{ height: offsets.at(-1)! - offsets[end]! }}
        />
      )}
      {footer}
    </div>
  );
}

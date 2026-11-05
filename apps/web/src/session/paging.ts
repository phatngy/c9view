import type { SessionDetailResponse } from '@c9view/api';
import { SESSION_PAGE_SIZE, type SessionPageParam } from '../api.js';

export function previousSessionPage(
  first: SessionDetailResponse,
): SessionPageParam | undefined {
  if (first.prevCursor === null || first.cursor <= 0) return undefined;
  const cursor = Math.max(0, first.cursor - SESSION_PAGE_SIZE);
  return { cursor, limit: first.cursor - cursor, fill: 'end' };
}

export function nextSessionPage(
  last: SessionDetailResponse,
  polledTotal: number | undefined,
): SessionPageParam | undefined {
  if (last.nextCursor !== null)
    return { cursor: last.nextCursor, limit: SESSION_PAGE_SIZE };
  if (!last.messages.length) return undefined;
  return polledTotal !== undefined && polledTotal > last.totalMessages
    ? { cursor: last.totalMessages, limit: SESSION_PAGE_SIZE }
    : undefined;
}

/** User initiated navigation animates only when motion is welcome. */
export function smoothScrollBehavior(): ScrollBehavior {
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : 'smooth';
}

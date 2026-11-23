import type {
  MessagePositionResponse,
  SessionDetailResponse,
} from '@c9view/api';
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

/** True when a page holds the message, or the message that made the tool call. */
export function pageHolds(page: SessionDetailResponse, id: string): boolean {
  return page.messages.some(
    (m) =>
      m.uuid === id ||
      m.blocks.some((b) => b.type === 'tool_use' && b.id === id),
  );
}

/** Most pages one jump loads after the page that holds the target's position. */
export const POSITION_FOLLOW_PAGES = 19;

/**
 * Loads the page that holds a message from its position. A page cut short by the
 * byte budget may end before the message, so later pages follow until it appears.
 * The result replaces the loaded pages: it starts at the target's page and the
 * usual previous and next paging continue from there.
 */
export async function loadPositionedPages(
  position: MessagePositionResponse,
  id: string,
  fetchPage: (param: SessionPageParam) => Promise<SessionDetailResponse>,
): Promise<{
  pages: SessionDetailResponse[];
  pageParams: SessionPageParam[];
}> {
  const first: SessionPageParam = {
    cursor: position.cursor,
    limit: position.limit,
  };
  const pages = [await fetchPage(first)];
  const pageParams = [first];
  while (
    !pageHolds(pages.at(-1)!, id) &&
    pages.at(-1)!.nextCursor !== null &&
    pages.at(-1)!.nextCursor! <= position.ordinal &&
    pages.length <= POSITION_FOLLOW_PAGES
  ) {
    const param: SessionPageParam = {
      cursor: pages.at(-1)!.nextCursor!,
      limit: SESSION_PAGE_SIZE,
    };
    pages.push(await fetchPage(param));
    pageParams.push(param);
  }
  return { pages, pageParams };
}

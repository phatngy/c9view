/**
 * Byte budgets for paged responses (001 FR-008, research R4). Sizes are the
 * UTF-8 length of the JSON that is sent, measured after redaction.
 */

export const TRUNCATED_MARKER = '… truncated to fit the page budget';

export function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
}

export interface BudgetedPage<T> {
  items: T[];
  /** How many source items the page covers (a shrunk item counts as one). */
  count: number;
  /** True when the page stopped before the end of `items`. */
  more: boolean;
  /** True when the single item on the page was shrunk to fit. */
  truncated: boolean;
}

export interface BudgetOptions<T> {
  /** Encoded size of the response without any items, in bytes. */
  envelopeBytes: number;
  budgetBytes: number;
  /** Take items from the end of the list instead of the start. */
  fromEnd?: boolean;
  /**
   * Make one item fit `roomBytes`. Called only when the first item of a page
   * does not fit on its own. Returning null drops the cut and sends the item
   * whole, so a page always makes progress.
   */
  shrink?: (item: T, roomBytes: number) => T | null;
}

/**
 * Adds already-redacted items while the encoded page stays within the budget.
 * Never cuts JSON: an item is either whole, shrunk by `shrink`, or left for the
 * next page. A page always holds at least one item when any are left.
 */
export function budgetItems<T>(
  items: readonly T[],
  options: BudgetOptions<T>,
): BudgetedPage<T> {
  const { envelopeBytes, budgetBytes, fromEnd = false } = options;
  const order = fromEnd ? [...items].reverse() : items;
  const taken: T[] = [];
  let used = envelopeBytes;
  for (const item of order) {
    const size = encodedBytes(item) + (taken.length ? 1 : 0);
    if (used + size <= budgetBytes) {
      taken.push(item);
      used += size;
      continue;
    }
    if (!taken.length) {
      const room = Math.max(0, budgetBytes - envelopeBytes);
      const shrunk = options.shrink?.(item, room) ?? null;
      const page = [shrunk ?? item];
      return {
        items: page,
        count: 1,
        more: items.length > 1,
        truncated: shrunk !== null,
      };
    }
    break;
  }
  if (fromEnd) taken.reverse();
  return {
    items: taken,
    count: taken.length,
    more: taken.length < items.length,
    truncated: false,
  };
}

/** Largest prefix of `text` whose JSON encoding fits `roomBytes`, with the marker. */
export function fitText(text: string, roomBytes: number): string {
  if (encodedBytes(text) <= roomBytes) return text;
  const marker = encodedBytes(TRUNCATED_MARKER) - 2;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encodedBytes(cut(text, middle)) + marker <= roomBytes) low = middle;
    else high = middle - 1;
  }
  return cut(text, low) + TRUNCATED_MARKER;
}

/** Avoids splitting a surrogate pair. */
function cut(text: string, length: number): string {
  const code = text.charCodeAt(length - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
}

/** Offset cursors for list routes. Opaque to clients; only this node reads them. */
export function readOffsetCursor(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  if (!/^\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}

export interface OffsetPage<T> {
  items: T[];
  nextCursor: string | null;
  truncated: boolean;
}

/**
 * Pages `all[offset..]` under the budget. `envelopeBytes` is the encoded
 * response with an empty list; 64 bytes of slack cover the cursor fields.
 */
export function budgetOffsetPage<T>(
  all: readonly T[],
  offset: number,
  budgetBytes: number,
  envelopeBytes: number,
  shrink?: (item: T, roomBytes: number) => T | null,
): OffsetPage<T> {
  const rest = all.slice(offset);
  const page = budgetItems(rest, {
    envelopeBytes: envelopeBytes + 64,
    budgetBytes,
    ...(shrink ? { shrink } : {}),
  });
  return {
    items: page.items,
    nextCursor: page.more ? String(offset + page.count) : null,
    truncated: page.truncated,
  };
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Keeps whole hunks while they fit `roomBytes`, then as many lines of the next
 * one as fit. Returns whether anything was dropped.
 */
export function fitHunks<T extends Hunk>(
  hunks: readonly T[],
  roomBytes: number,
): { hunks: T[]; cut: boolean } {
  const kept: T[] = [];
  let used = 2;
  for (const hunk of hunks) {
    const size = encodedBytes(hunk) + (kept.length ? 1 : 0);
    if (used + size <= roomBytes) {
      kept.push(hunk);
      used += size;
      continue;
    }
    const lines: string[] = [];
    let lineBytes =
      encodedBytes({ ...hunk, lines: [] }) + (kept.length ? 1 : 0);
    for (const line of hunk.lines) {
      const next = encodedBytes(line) + (lines.length ? 1 : 0);
      if (used + lineBytes + next > roomBytes) break;
      lines.push(line);
      lineBytes += next;
    }
    if (lines.length) kept.push({ ...hunk, lines });
    return { hunks: kept, cut: true };
  }
  return { hunks: kept, cut: false };
}

import { Hono } from 'hono';
import { searchMessages } from '../data/indexed.js';
import { redactStrings } from '../data/redaction.js';
import { redactText } from '@c9view/core';
import { z } from 'zod';
import type { SearchResponse } from '@c9view/api';
import type { DataStore } from '../data/store.js';
import { DEFAULT_NODE_LIMITS, type NodeLimits } from '../limits.js';
import { budgetItems, encodedBytes } from '../budget.js';

const parameters = z.object({
  q: z
    .string()
    .max(500)
    .trim()
    .min(1)
    .max(500)
    .refine((q) => q.replace(/\p{Cc}/gu, '').trim().length > 0),
  projectId: z.string().optional(),
  model: z.string().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, 200))
    .default(50),
  cursor: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .refine(Number.isSafeInteger)
    .optional(),
});
const fold = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC');
export function queryTokens(query: string) {
  return [...query.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*\*?/gu)].map(
    (m) => ({
      term: fold(m[0].replace(/\*$/u, '')),
      prefix: m[0].endsWith('*'),
    }),
  );
}
export function mergeRanges(ranges: [number, number][]) {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
export function snippet(text: string, query: string) {
  const safe = redactText(text);
  const terms = queryTokens(query);
  const hidden = [...safe.matchAll(/«redacted:[^»]*»/gu)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  const ranges: [number, number][] = [];
  for (const match of safe.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) {
    const start = match.index,
      end = start + match[0].length;
    if (hidden.some(([a, b]) => start < b! && end > a!)) continue;
    const token = fold(match[0]);
    for (const { term, prefix } of terms)
      if (prefix ? token.startsWith(term) : token === term)
        ranges.push([start, end]);
  }
  const merged = mergeRanges(ranges);
  let start = Math.max(0, (merged[0]?.[0] ?? 0) - 80);
  // Keep redaction placeholders intact when selecting the snippet window.
  const inside = hidden.find(([a, b]) => start > a! && start < b!);
  if (inside) start = inside[0]!;
  let end = Math.min(safe.length, start + 240);
  const ending = hidden.find(([a, b]) => end > a! && end < b!);
  if (ending) end = ending[0]!;
  return {
    snippet: safe.slice(start, end),
    cutStart: start > 0,
    cutEnd: end < safe.length,
    highlights: merged
      .filter(([a, b]) => a >= start && b <= end)
      .map(([a, b]) => [a - start, b - start] as [number, number]),
  };
}
export function searchRoutes(
  store: DataStore,
  limits: Pick<NodeLimits, 'pageBudgetBytes'> = DEFAULT_NODE_LIMITS,
) {
  const app = new Hono();
  app.get('/search', (c) => {
    const parsed = parameters.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: 'Invalid search parameters' }, 400);
    const db = store.readyIndex;
    if (!db)
      return c.json(
        { error: 'Search is available once indexing finishes' },
        503,
      );
    const { q, limit, cursor = 0, ...filters } = parsed.data;
    const definedFilters = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v !== undefined),
    ) as { projectId?: string; model?: string; from?: string; to?: string };
    const terms = queryTokens(q);
    const expression = terms
      .map(({ term, prefix }) => `"${term}"${prefix ? '*' : ''}`)
      .join(' AND ');
    const rows = terms.length
      ? searchMessages(db, expression, definedFilters, limit + 1, cursor)
      : [];
    const results: SearchResponse['results'] = redactStrings(
      rows.slice(0, limit).map(({ projectId, ...m }) => ({
        projectId,
        sessionId: m.sessionId,
        messageUuid: m.uuid,
        timestamp: m.timestamp,
        role: m.role,
        model: m.model,
        ...snippet(m.text, q),
      })),
    );
    // Snippets are short, so a page only stops early with a very small budget.
    const page = budgetItems(results, {
      envelopeBytes: encodedBytes({ results: [], nextCursor: null }) + 64,
      budgetBytes: limits.pageBudgetBytes,
    });
    const response: SearchResponse = {
      results: page.items,
      nextCursor: page.more
        ? String(cursor + page.count)
        : rows.length > limit
          ? String(cursor + limit)
          : null,
    };
    return c.json(response);
  });
  return app;
}

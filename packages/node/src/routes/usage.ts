import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiError } from '@c9view/api';
import type { DataStore } from '../data/store.js';
import { dateInZone, usageData } from '../data/usage.js';
import { redactStrings } from '../data/redaction.js';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
const parameters = z.object({
  from: date.optional(),
  to: date.optional(),
  tz: z
    .string()
    .default('UTC')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }),
  projectId: z.string().optional(),
});
export function usageRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/usage', (c) => {
    const parsed = parameters.safeParse(c.req.query());
    if (!parsed.success)
      return c.json(
        { error: 'Invalid usage parameters' } satisfies ApiError,
        400,
      );
    const { tz, projectId } = parsed.data;
    const to = parsed.data.to ?? dateInZone(new Date(), tz);
    const from =
      parsed.data.from ??
      new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
    const span = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    if (span < 1 || span > 366)
      return c.json(
        {
          error: 'Usage range must be between 1 and 366 days',
        } satisfies ApiError,
        400,
      );
    if (!store.readyIndex)
      return c.json(
        {
          error: 'Charts are available once indexing finishes',
        } satisfies ApiError,
        503,
      );
    return c.json(
      redactStrings(
        usageData(store.readyIndex, from, to, tz, projectId || undefined),
      ),
    );
  });
  return app;
}

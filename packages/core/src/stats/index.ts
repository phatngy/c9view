import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const dailyActivitySchema = z
  .object({
    date: z.string().optional().catch(undefined),
    messageCount: z.number().optional().catch(undefined),
    sessionCount: z.number().optional().catch(undefined),
    toolCallCount: z.number().optional().catch(undefined),
  })
  .passthrough();

const dailyModelTokensSchema = z
  .object({
    date: z.string().optional().catch(undefined),
    tokensByModel: z.record(z.string(), z.number()).catch({}),
  })
  .passthrough();

const modelUsageSchema = z
  .object({
    inputTokens: z.number().catch(0),
    outputTokens: z.number().catch(0),
    cacheReadInputTokens: z.number().catch(0),
    cacheCreationInputTokens: z.number().catch(0),
    webSearchRequests: z.number().catch(0),
    costUSD: z.number().catch(0),
  })
  .passthrough();

export const statsCacheSchema = z
  .object({
    dailyActivity: z.array(dailyActivitySchema).catch([]),
    dailyModelTokens: z.array(dailyModelTokensSchema).catch([]),
    firstSessionDate: z.string().optional().catch(undefined),
    hourCounts: z.record(z.string(), z.number()).catch({}),
    lastComputedDate: z.string().optional().catch(undefined),
    longestSession: z
      .object({
        sessionId: z.string().optional().catch(undefined),
        duration: z.number().optional().catch(undefined),
        messageCount: z.number().optional().catch(undefined),
        timestamp: z
          .union([z.string(), z.number()])
          .optional()
          .catch(undefined),
      })
      .passthrough()
      .catch({}),
    modelUsage: z.record(z.string(), modelUsageSchema).catch({}),
    totalMessages: z.number().catch(0),
    totalSessions: z.number().catch(0),
    version: z.number().optional().catch(undefined),
  })
  .passthrough();

export type StatsCache = z.infer<typeof statsCacheSchema>;

export const historyEntrySchema = z
  .object({
    display: z.string(),
    timestamp: z.number(),
    project: z.string(),
    pastedContents: z.record(z.string(), z.unknown()).optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export async function readStatsCache(
  claudeDir: string,
): Promise<StatsCache | null> {
  let contents: string;
  try {
    contents = await readFile(path.join(claudeDir, 'stats-cache.json'), 'utf8');
  } catch {
    return null;
  }
  try {
    return statsCacheSchema.parse(JSON.parse(contents) as unknown);
  } catch {
    return null;
  }
}

export interface ReadHistoryOptions {
  limit?: number;
}

export async function readHistory(
  claudeDir: string,
  options: ReadHistoryOptions = {},
): Promise<HistoryEntry[]> {
  let contents: string;
  try {
    contents = await readFile(path.join(claudeDir, 'history.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = historyEntrySchema.safeParse(JSON.parse(line) as unknown);
      if (parsed.success) entries.push(parsed.data);
    } catch {
      // Malformed JSONL lines are skipped; later valid lines remain readable.
    }
  }
  if (options.limit === undefined || !Number.isFinite(options.limit))
    return entries;
  const limit = Math.max(0, Math.floor(options.limit));
  return limit === 0 ? [] : entries.slice(-limit);
}

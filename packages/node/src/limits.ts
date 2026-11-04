import { z } from 'zod';

export const DEFAULT_NODE_LIMITS = Object.freeze({
  requestBodyMaxBytes: 49152,
  responseChunkMaxBytes: 262144,
  requestDeadlineMs: 30000,
  requestIdleMs: 10000,
  maxOpenRequests: 16,
  pageBudgetBytes: 1048576,
  fileBudgetBytes: 8388608,
});
export type NodeLimits = {
  -readonly [K in keyof typeof DEFAULT_NODE_LIMITS]: number;
};
const variables = {
  requestBodyMaxBytes: 'C9VIEW_REQUEST_BODY_MAX_BYTES',
  responseChunkMaxBytes: 'C9VIEW_RESPONSE_CHUNK_MAX_BYTES',
  requestDeadlineMs: 'C9VIEW_REQUEST_DEADLINE_MS',
  requestIdleMs: 'C9VIEW_REQUEST_IDLE_MS',
  maxOpenRequests: 'C9VIEW_NODE_MAX_OPEN_REQUESTS',
  pageBudgetBytes: 'C9VIEW_PAGE_BUDGET_BYTES',
  fileBudgetBytes: 'C9VIEW_FILE_BUDGET_BYTES',
} as const;
const positiveInteger = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

export function loadNodeLimits(
  env: Record<string, string | undefined> = process.env,
): NodeLimits {
  const limits: NodeLimits = { ...DEFAULT_NODE_LIMITS };
  for (const key of Object.keys(variables) as (keyof NodeLimits)[]) {
    const variable = variables[key];
    if (env[variable] === undefined) continue;
    const parsed = positiveInteger.safeParse(env[variable]);
    if (!parsed.success)
      throw new Error(`${variable} must be a positive safe integer`);
    limits[key] = parsed.data;
  }
  return limits;
}

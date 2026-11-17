import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { readTextResult } from '@c9view/core';

export type InboundValue = 'accept' | 'hold' | 'refuse';
/** `refuse` blocks; `hold` and `may-hold` warn; `none` is silent. */
export type InboundResult = 'refuse' | 'hold' | 'may-hold' | 'none';

const valueSchema = z.enum(['accept', 'hold', 'refuse']);
const fileSchema = z.object({ crossSessionInbound: z.unknown().optional() });
const rank: Record<InboundValue, number> = { accept: 0, hold: 1, refuse: 2 };
/** Modes Claude Code treats as prompting; a sender with no mode is accepted. */
const PROMPTING = new Set(['default', 'acceptEdits', 'plan', 'auto']);

type Layer = InboundValue | 'unset';

/**
 * One settings layer. A missing file is unset; a file that exists but cannot
 * be read or parsed, or an invalid value, counts as `hold` (Claude Code holds
 * everything while one is present). Read-only, root-confined, key only.
 */
async function readLayer(path: string, root: string): Promise<Layer> {
  const read = await readTextResult(path, { roots: [root] });
  if (!read) {
    try {
      await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unset';
    }
    return 'hold';
  }
  if (read.denied) return 'hold';
  let json: unknown;
  try {
    json = JSON.parse(read.content);
  } catch {
    return 'hold';
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) return 'hold';
  const value = parsed.data.crossSessionInbound;
  if (value === undefined) return 'unset';
  const checked = valueSchema.safeParse(value);
  return checked.success ? checked.data : 'hold';
}

/**
 * The advisory `crossSessionInbound` rule (R7 step 15). Managed policy and the
 * `--settings` flag cannot be read, so the user value is the base. Project and
 * local layers can only tighten (accept < hold < refuse). When nothing is set,
 * a prompting-class receiver accepts c9view's message (it sends no mode);
 * bypass or an unknown mode holds it. Not `readSettings`/`mergeSettings`.
 */
export async function inboundRule(input: {
  claudeDir: string;
  cwd: string | undefined;
  mode: string | undefined;
}): Promise<InboundResult> {
  let current: Layer = await readLayer(
    join(input.claudeDir, 'settings.json'),
    input.claudeDir,
  );
  const cwd = input.cwd;
  const layers: Layer[] =
    cwd && isAbsolute(cwd)
      ? await Promise.all(
          ['settings.json', 'settings.local.json'].map((name) =>
            readLayer(join(cwd, '.claude', name), join(cwd, '.claude')),
          ),
        )
      : // Without a usable cwd the repo layers cannot be read: fail closed.
        ['hold'];
  for (const layer of layers)
    if (
      layer !== 'unset' &&
      layer !== 'accept' &&
      (current === 'unset' || rank[layer] > rank[current])
    )
      current = layer;
  if (current === 'refuse') return 'refuse';
  if (current === 'hold') return 'hold';
  if (current === 'accept') return 'none';
  return input.mode !== undefined && PROMPTING.has(input.mode)
    ? 'none'
    : 'may-hold';
}

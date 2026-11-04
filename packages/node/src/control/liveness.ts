import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  readLiveEntries,
  pidNamespace,
  processAlive,
  type LiveEntry,
} from '../data/status.js';
import { ControlError } from './errors.js';
export type Liveness = (sessionId: string) => Promise<void>;
const liveSchema = z
  .object({
    sessionId: z.string(),
    pid: z.number().int().positive().optional(),
    pidDomain: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
export function createLiveness(claudeDir: string): Liveness {
  return async (sessionId) => {
    const unknown = () =>
      new ControlError(
        409,
        'Cannot determine whether another process holds this session; fork and reply instead',
        'liveness-unknown',
      );
    const directory = join(claudeDir, 'sessions');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw unknown();
    }
    // Read every JSON entry as well as the display helper's newest entry: two
    // processes for the same session must not hide each other. Never read keys.
    const entries: LiveEntry[] = [];
    for (const name of names.filter((name) => name.endsWith('.json'))) {
      try {
        const parsed = liveSchema.parse(
          JSON.parse(await readFile(join(directory, name), 'utf8')),
        );
        if (parsed.sessionId === sessionId) entries.push(parsed);
      } catch {
        throw unknown();
      }
    }
    const newest = (await readLiveEntries(claudeDir)).get(sessionId);
    if (newest) entries.push(newest);
    if (!entries.length) return;
    const namespace = await pidNamespace();
    for (const entry of entries) {
      const domain =
        entry.pidDomain === undefined
          ? undefined
          : (String(entry.pidDomain).match(/(?:pid:\[)?(\d+)\]?$/)?.[1] ??
            String(entry.pidDomain));
      if ((domain && (!namespace || domain !== namespace)) || !entry.pid)
        throw unknown();
      if (processAlive(entry.pid))
        throw new ControlError(
          409,
          'Session is live elsewhere; fork and reply instead',
          'live-elsewhere',
        );
    }
  };
}

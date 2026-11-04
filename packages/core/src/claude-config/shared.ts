import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { z } from 'zod';
import { redactValue } from '../redact/index.js';

export type Scope = 'user' | 'project' | 'local' | 'plugin';
export interface Source {
  scope: Scope;
  path: string;
}
export type JsonRecord = Record<string, unknown>;
export interface SettingsLayer {
  data: JsonRecord;
  source: Source;
}
export const recordSchema = z.record(z.string(), z.unknown());
export function record(value: unknown): JsonRecord {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
/** Every reader routes its detached output through this boundary. */
export function clean<T>(value: T): T {
  return redactValue(value) as T;
}
export interface ReadPolicy {
  roots: string[];
  /** Only the MCP inventory may open this specific global config file. */
  globalMcpPath?: string;
}
export type TextRead =
  | { content: string; denied?: never; reason?: never }
  | { denied: true; reason: string; content?: never };
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return (
    rel === '' ||
    (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  );
};
const deniedName = (path: string, globalMcpPath?: string): boolean =>
  path
    .split(/[\\/]/)
    .some(
      (part) =>
        /^(?:\.ssh|\.gnupg|\.aws|\.codex|\.config|\.kube|\.docker)$/.test(
          part,
        ) ||
        /^(?:\.credentials\.json|auth\.json|\.netrc|\.npmrc|\.pypirc|\.env.*|id_.*)$/.test(
          part,
        ) ||
        /\.(?:pem|key)$/i.test(part) ||
        (part === '.claude.json' && resolve(path) !== globalMcpPath),
    );
/** One policy boundary for every config read, including symlink targets and binary data. */
export async function readTextResult(
  path: string,
  policy: ReadPolicy = { roots: [dirname(path)] },
): Promise<TextRead | undefined> {
  const denied = (reason: string): TextRead => ({ denied: true, reason });
  const requested = resolve(path);
  if (deniedName(requested, policy.globalMcpPath))
    return denied('sensitive path');
  try {
    const canonical = await realpath(requested);
    if (deniedName(canonical, policy.globalMcpPath))
      return denied('sensitive path');
    const roots = await Promise.all(
      policy.roots.map(async (root) => {
        try {
          return await realpath(root);
        } catch {
          return resolve(root);
        }
      }),
    );
    if (!roots.some((root) => inside(root, canonical)))
      return denied('outside allowed roots');
    if (
      /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|bz2|xz|7z|tar|sqlite3?|db|woff2?|ttf|otf|mp[34]|wav|exe|dll|so|bin)$/i.test(
        basename(canonical),
      )
    )
      return denied('non-text file');
    const handle = await open(
      canonical,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!(await handle.stat()).isFile()) return denied('non-text file');
      const sample = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const bytes = sample.subarray(0, bytesRead);
      if (
        bytes.some((byte) => byte === 0 || byte < 8 || (byte > 13 && byte < 32))
      )
        return denied('non-text file');
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
          stream: true,
        });
      } catch {
        return denied('non-text file');
      }
      return { content: await handle.readFile('utf8') };
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}
export async function readText(
  path: string,
  policy?: ReadPolicy,
): Promise<string | undefined> {
  return (await readTextResult(path, policy))?.content;
}
export async function readJson(
  path: string,
  policy?: ReadPolicy,
): Promise<JsonRecord | undefined> {
  const text = await readText(path, policy);
  if (text === undefined) return undefined;
  try {
    const result = recordSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
export async function entries(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort();
  } catch {
    return [];
  }
}

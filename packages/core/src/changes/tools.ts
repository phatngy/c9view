import { notebookAfter } from './notebook.js';
import { applyPatch, structuredPatch } from 'diff';
import { z } from 'zod';
import { relative } from 'node:path';
import { deniedPath, inside } from '../files/policy.js';
import { redactText } from '../redact/index.js';
import type { TranscriptRecord } from '../transcript/index.js';
import type { ChangeHunk, ToolChange } from './types.js';
export const CONTENT_LIMIT = 2_000_000;
export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const hunkSchema = z
  .object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
    lines: z.array(z.string()),
  })
  .passthrough();
export function counts(hunks: ChangeHunk[]) {
  let additions = 0,
    deletions = 0;
  for (const h of hunks)
    for (const line of h.lines) {
      if (line.startsWith('+')) additions++;
      if (line.startsWith('-')) deletions++;
    }
  return { additions, deletions };
}
export function makeHunks(before: string, after: string): ChangeHunk[] {
  if (
    Buffer.byteLength(before) > CONTENT_LIMIT ||
    Buffer.byteLength(after) > CONTENT_LIMIT
  )
    return [];
  return structuredPatch('file', 'file', before, after, undefined, undefined, {
    context: 3,
  }).hunks;
}
export function applyHunks(
  before: string,
  hunks: ChangeHunk[],
): string | undefined {
  const value = applyPatch(before, {
    oldFileName: 'file',
    newFileName: 'file',
    oldHeader: undefined,
    newHeader: undefined,
    hunks,
  });
  return value === false ? undefined : value;
}
export interface DetailedChange {
  change: ToolChange;
  before?: string;
  after?: string;
}
const extractionCache = new WeakMap<
  readonly TranscriptRecord[],
  Map<string, DetailedChange[]>
>();
export function detailedChanges(
  records: readonly TranscriptRecord[],
  root = records.find((r) => typeof r.cwd === 'string')?.cwd as
    string | undefined,
): DetailedChange[] {
  const key = root ?? '';
  const cached = extractionCache.get(records)?.get(key);
  if (cached) return cached;
  const results = new Map<
    string,
    { failed: boolean; value: Record<string, unknown> }
  >();
  for (const r of records) {
    const content = obj(r.message).content;
    if (!Array.isArray(content)) continue;
    for (const b of content.map(obj))
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string')
        results.set(b.tool_use_id, {
          failed: b.is_error === true || r.is_error === true,
          value: obj(r.toolUseResult),
        });
  }
  const output: DetailedChange[] = [];
  const lastByFile = new Map<string, DetailedChange>();
  const seen = new Set<string>();
  for (const [index, r] of records.entries()) {
    const content = obj(r.message).content;
    if (!Array.isArray(content)) continue;
    for (const b of content.map(obj)) {
      if (
        b.type !== 'tool_use' ||
        !['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(str(b.name)) ||
        typeof b.id !== 'string' ||
        seen.has(b.id)
      )
        continue;
      seen.add(b.id);
      const result = results.get(b.id);
      if (result?.failed) continue;
      const data = result?.value ?? {};
      const input = obj(b.input);
      const filePath =
        str(data.filePath) || str(input.file_path) || str(input.notebook_path);
      if (
        !filePath ||
        deniedPath(
          root && inside(root, filePath) ? relative(root, filePath) : filePath,
        )
      )
        continue;
      const original =
        typeof data.originalFile === 'string' ? data.originalFile : undefined;
      const kind =
        data.type === 'create' ||
        (b.name === 'Write' && original === undefined && data.type !== 'update')
          ? 'create'
          : 'update';
      let before = original ?? (kind === 'create' ? '' : undefined);
      let after: string | undefined;
      let hunks: ChangeHunk[] = [];
      const parsed = z.array(hunkSchema).safeParse(data.structuredPatch);
      let source: ToolChange['source'] = parsed.success
        ? 'structuredPatch'
        : 'computed';
      const bytes = [
        original,
        data.content,
        input.content,
        input.old_string,
        input.new_string,
        input.new_source,
        data.structuredPatch,
        input.edits,
      ].reduce<number>(
        (n, v) =>
          Math.max(
            n,
            Buffer.byteLength(
              typeof v === 'string' ? v : (JSON.stringify(v) ?? ''),
            ),
          ),
        0,
      );
      let tooLarge = bytes > CONTENT_LIMIT;
      if (!tooLarge) {
        if (parsed.success) {
          hunks = parsed.data;
          // Full-file reconstruction is deferred until the file diff is requested.
        } else if (original !== undefined && typeof data.content === 'string') {
          after = data.content;
          hunks = makeHunks(original, after);
        } else if (b.name === 'NotebookEdit' && before !== undefined) {
          after = notebookAfter(before, input);
          if (after !== undefined) hunks = makeHunks(before, after);
        } else if (b.name === 'Write') {
          after = str(input.content ?? data.content);
          // A result without originalFile cannot prove an overwrite was a create.
          hunks = makeHunks(before ?? '', after);
        } else if (
          b.name === 'Edit' &&
          before !== undefined &&
          str(input.old_string) &&
          input.replace_all !== true &&
          before.includes(str(input.old_string))
        ) {
          const old = str(input.old_string);
          const at = before.indexOf(old);
          const start = before.lastIndexOf('\n', at - 1) + 1;
          const next = before.indexOf('\n', at + old.length);
          const end = next < 0 ? before.length : next + 1;
          const segment = before.slice(start, end);
          hunks = makeHunks(
            segment,
            segment.replace(old, () => str(input.new_string)),
          );
          const offset = before.slice(0, start).split('\n').length - 1;
          hunks = hunks.map((h) => ({
            ...h,
            oldStart: h.oldStart + offset,
            newStart: h.newStart + offset,
          }));
          // Use the same lazy reconstruction as structured patches.
          source = 'computed';
        } else {
          const edits =
            b.name === 'MultiEdit' && Array.isArray(input.edits)
              ? input.edits.map(obj)
              : [input];
          if (before !== undefined) {
            after = before;
            for (const edit of edits) {
              const old = str(edit.old_string),
                replacement = str(edit.new_string ?? edit.new_source);
              if (old && after.includes(old))
                after =
                  edit.replace_all === true
                    ? after.split(old).join(replacement)
                    : after.replace(old, () => replacement);
            }
            hunks = makeHunks(before, after);
          } else {
            hunks = edits.flatMap((edit) =>
              makeHunks(
                str(edit.old_string),
                str(edit.new_string ?? edit.new_source),
              ),
            );
          }
          source = 'computed';
        }
      }
      tooLarge ||=
        (before !== undefined && Buffer.byteLength(before) > CONTENT_LIMIT) ||
        (after !== undefined && Buffer.byteLength(after) > CONTENT_LIMIT);
      if (tooLarge) hunks = [];
      const change: ToolChange = {
        toolUseId: b.id,
        messageUuid: str(r.uuid) || `record-${index}`,
        timestamp: typeof r.timestamp === 'string' ? r.timestamp : null,
        tool: str(b.name),
        filePath,
        kind,
        hunks,
        ...counts(hunks),
        source,
        userModified: data.userModified === true,
        ...(tooLarge ? { tooLarge: true } : {}),
      };
      if (tooLarge) {
        before = undefined;
        after = undefined;
      }
      const previous = lastByFile.get(filePath);
      const first = !previous;
      if (previous) delete previous.after;
      const entry: DetailedChange = { change };
      if (first && before !== undefined) entry.before = before;
      if (
        !tooLarge &&
        (after !== undefined || (hunks.length > 0 && before !== undefined))
      ) {
        const base = before;
        Object.defineProperty(entry, 'after', {
          configurable: true,
          get: () =>
            after ?? (base === undefined ? undefined : applyHunks(base, hunks)),
        });
      }
      output.push(entry);
      lastByFile.set(filePath, entry);
    }
  }
  const cachedRoots =
    extractionCache.get(records) ?? new Map<string, DetailedChange[]>();
  cachedRoots.set(key, output);
  extractionCache.set(records, cachedRoots);
  return output;
}
export function extractToolChanges(
  records: readonly TranscriptRecord[],
  {
    maxPerFile = Infinity,
    maxSession = Infinity,
  }: { maxPerFile?: number; maxSession?: number } = {},
): ToolChange[] {
  const perFile = new Map<string, number>();
  let total = 0;
  return detailedChanges(records)
    .filter(({ change }) => {
      const count = perFile.get(change.filePath) ?? 0;
      if (count >= maxPerFile || total >= maxSession) return false;
      perFile.set(change.filePath, count + 1);
      total++;
      return true;
    })
    .map((d) => safeChange(d.change));
}

/** Redact only hunks that are about to leave the core. */
export function safeChange(change: ToolChange): ToolChange {
  const hunks = change.hunks;
  const safeHunks = hunks.map((h) => {
    // Preserve each diff prefix/line number while masking multiline PEM bodies.
    let privateKey = false;
    return {
      ...h,
      lines: h.lines.map((line) => {
        privateKey ||= /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line);
        const safe = privateKey
          ? line[0] + '«redacted:private-key»'
          : line[0] + redactText(line.slice(1));
        if (/-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line))
          privateKey = false;
        return safe;
      }),
    };
  });

  return { ...change, filePath: redactText(change.filePath), hunks: safeHunks };
}

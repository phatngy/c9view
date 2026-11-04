import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { parseRecord, type TranscriptRecord } from './schemas.js';

export interface ReadTranscriptOptions {
  fromOffset?: number;
}
export interface TranscriptLine {
  record: TranscriptRecord;
  offset: number;
  /** One-based line number relative to fromOffset. */ line: number;
}
export interface TranscriptReadResult {
  endOffset: number;
  malformed: number;
  reset?: boolean;
}

/** Only newline-terminated records are committed. The generator's return value
 * includes progress over malformed/blank lines, including files with no records.
 * fromOffset must be a byte offset at a line boundary, as returned by this API.
 */
export async function* readTranscript(
  path: string,
  options: ReadTranscriptOptions = {},
): AsyncGenerator<TranscriptLine, TranscriptReadResult> {
  let endOffset = options.fromOffset ?? 0;
  if (!Number.isSafeInteger(endOffset) || endOffset < 0)
    throw new RangeError('fromOffset must be a nonnegative safe integer');
  let malformed = 0;
  let line = 0;
  let fragments: Buffer[] = [];
  let reset = false;
  // A smaller replacement/truncated file invalidates the saved byte offset; restart from its beginning.
  if (endOffset > (await stat(path)).size) {
    endOffset = 0;
    reset = true;
  }
  const stream = createReadStream(path, { start: endOffset });
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    let start = 0;
    for (
      let index = buffer.indexOf(10);
      index !== -1;
      index = buffer.indexOf(10, start)
    ) {
      fragments.push(buffer.subarray(start, index));
      const bytes =
        fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments);
      endOffset += bytes.length + 1;
      line++;
      fragments = [];
      start = index + 1;
      const text = bytes.toString('utf8').trim();
      if (!text) continue;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        malformed++;
        continue;
      }
      if (
        typeof json !== 'object' ||
        json === null ||
        Array.isArray(json) ||
        typeof (json as Record<string, unknown>).type !== 'string'
      ) {
        malformed++;
        continue;
      }
      yield { record: parseRecord(json), offset: endOffset, line };
    }
    if (start < buffer.length) fragments.push(buffer.subarray(start));
  }
  return { endOffset, malformed, ...(reset ? { reset: true } : {}) };
}

export async function readTranscriptFile(
  path: string,
  options: ReadTranscriptOptions = {},
): Promise<TranscriptReadResult & { records: TranscriptRecord[] }> {
  const records: TranscriptRecord[] = [];
  const reader = readTranscript(path, options);
  for (;;) {
    const next = await reader.next();
    if (next.done) return { records, ...next.value };
    records.push(next.value.record);
  }
}

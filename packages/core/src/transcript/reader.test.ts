import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTranscript, readTranscriptFile } from './reader.js';

const directories: string[] = [];
async function temporaryFile(content: string | Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-transcript-'));
  directories.push(dir);
  const path = join(dir, 'session.jsonl');
  await writeFile(path, content);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('transcript reader', () => {
  it('streams records with byte offsets, skips malformed lines, and preserves unknown types', async () => {
    const path = new URL('./__fixtures__/records.jsonl', import.meta.url)
      .pathname;
    const bytes = await readFile(path);
    const result = await readTranscriptFile(path);
    expect(result.records).toHaveLength(3);
    expect(result.malformed).toBe(1);
    expect(result.endOffset).toBe(bytes.length);
    expect(result.records[1]).toEqual({
      type: 'future-record',
      extra: { kept: true },
    });
    const lines = [];
    for await (const line of readTranscript(path)) lines.push(line);
    expect(lines.map((line) => line.line)).toEqual([1, 3, 4]);
    expect(lines[0]?.offset).toBe(bytes.indexOf(10) + 1);
    expect(
      (await readTranscriptFile(path, { fromOffset: lines[0]!.offset }))
        .records,
    ).toEqual(result.records.slice(1));
  });

  it('leaves a partial trailing line uncommitted and resumes once it is complete', async () => {
    const complete = '{"type":"user","message":{"content":"café"}}\r\n';
    const partial = '{"type":"future-record","value":"🌍"}';
    const path = await temporaryFile(complete + partial);
    const first = await readTranscriptFile(path);
    expect(first.records).toHaveLength(1);
    expect(first.endOffset).toBe(Buffer.byteLength(complete));
    expect(first.malformed).toBe(0);
    expect(
      await readTranscriptFile(path, { fromOffset: first.endOffset }),
    ).toEqual({ records: [], endOffset: first.endOffset, malformed: 0 });
    await appendFile(path, '\n');
    expect(
      await readTranscriptFile(path, { fromOffset: first.endOffset }),
    ).toEqual({
      records: [{ type: 'future-record', value: '🌍' }],
      endOffset: Buffer.byteLength(complete + partial + '\n'),
      malformed: 0,
    });
  });

  it('restarts from byte zero and reports reset when the saved offset exceeds a replacement file', async () => {
    const path = await temporaryFile('{"type":"future","value":1}\n');
    const result = await readTranscriptFile(path, { fromOffset: 500 });
    expect(result).toEqual({
      records: [{ type: 'future', value: 1 }],
      endOffset: Buffer.byteLength('{"type":"future","value":1}\n'),
      malformed: 0,
      reset: true,
    });
  });

  it('returns progress over blank/malformed lines even when nothing is yielded', async () => {
    const path = await temporaryFile('\n{bad}\nnull\n42\n{}\n{"type":');
    const reader = readTranscript(path);
    expect(await reader.next()).toEqual({
      done: true,
      value: {
        endOffset: Buffer.byteLength('\n{bad}\nnull\n42\n{}\n'),
        malformed: 4,
      },
    });
  });

  it('handles lines and UTF-8 characters crossing stream chunk boundaries', async () => {
    const text = 'a'.repeat(65500) + '🌍'.repeat(50);
    const line = JSON.stringify({ type: 'future', text }) + '\n';
    const path = await temporaryFile(line + '{"type":"partial"');
    const result = await readTranscriptFile(path);
    expect(result.records).toEqual([{ type: 'future', text }]);
    expect(result.endOffset).toBe(Buffer.byteLength(line));
  });
});

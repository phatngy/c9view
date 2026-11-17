import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReceiverMode } from './mode.js';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
async function transcript(lines: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'c9mode-'));
  roots.push(dir);
  const path = join(dir, 't.jsonl');
  await writeFile(
    path,
    lines
      .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
      .join('\n') + '\n',
  );
  return path;
}
const mode = (permissionMode: string) => ({
  type: 'permission-mode',
  permissionMode,
});

describe('T032a receiver mode', () => {
  it('uses the last permission-mode record', async () => {
    const p = await transcript([
      mode('plan'),
      { type: 'user' },
      mode('bypassPermissions'),
    ]);
    expect(await readReceiverMode(p)).toBe('bypassPermissions');
  });
  it('else the last permissionMode string on any record', async () => {
    const p = await transcript([
      { type: 'user', permissionMode: 'default' },
      { type: 'assistant', permissionMode: 'auto' },
      { type: 'user' },
    ]);
    expect(await readReceiverMode(p)).toBe('auto');
  });
  it('a permission-mode record wins over later plain fields', async () => {
    const p = await transcript([
      mode('plan'),
      { type: 'user', permissionMode: 'auto' },
    ]);
    expect(await readReceiverMode(p)).toBe('plan');
  });
  it('no record, missing or unreadable file is unknown', async () => {
    expect(
      await readReceiverMode(await transcript([{ type: 'user' }])),
    ).toBeUndefined();
    expect(
      await readReceiverMode('/nonexistent/c9view/t.jsonl'),
    ).toBeUndefined();
  });
  it('does not see a record outside the final 64 KiB, and reads only the tail', async () => {
    const filler = { type: 'user', message: { content: 'x'.repeat(1000) } };
    const early = await transcript([mode('plan'), ...Array(80).fill(filler)]);
    expect(await readReceiverMode(early)).toBeUndefined();
    const late = await transcript([
      ...Array(80).fill(filler),
      mode('acceptEdits'),
    ]);
    expect(await readReceiverMode(late)).toBe('acceptEdits');
  });
  it('ignores a cut first line, malformed lines and unknown fields', async () => {
    const p = await transcript([
      'not json permission',
      '{"type":"permission-mode"',
      { type: 'permission-mode', permissionMode: 7 },
      { type: 'permission-mode', permissionMode: 'default', extra: { a: 1 } },
      { type: 'weird', permissionMode: 'ignored-later-plain' },
    ]);
    expect(await readReceiverMode(p)).toBe('default');
    const small = await transcript(['x'.repeat(200), mode('auto')]);
    expect(await readReceiverMode(small, 150)).toBe('auto');
  });
});

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TranscriptStatusCache } from './transcript.js';
it('tracks assistant questions, tool results and completed turns incrementally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-transcript-status-'));
  const path = join(dir, 's.jsonl');
  const record = (type: string, content: unknown, extra = {}) =>
    JSON.stringify({
      type,
      timestamp: '2026-10-25T00:00:00Z',
      message: { id: 'a', content, ...extra },
    }) + '\n';
  try {
    const cache = new TranscriptStatusCache();
    await writeFile(path, record('user', 'User question?'));
    expect((await cache.get(path)).asksQuestion).toBe(false);
    await writeFile(
      path,
      record('assistant', [{ type: 'text', text: 'Which option?' }]),
      { flag: 'a' },
    );
    expect((await cache.get(path)).asksQuestion).toBe(true);
    await writeFile(
      path,
      record('assistant', [
        { type: 'tool_use', id: 't', name: 'Bash', input: {} },
      ]),
      { flag: 'a' },
    );
    expect((await cache.get(path)).lastAssistantPendingToolUse?.name).toBe(
      'Bash',
    );
    await writeFile(
      path,
      record('user', [
        { type: 'tool_result', tool_use_id: 't', content: 'done' },
      ]) +
        record('assistant', [{ type: 'text', text: 'Complete.' }], {
          stop_reason: 'end_turn',
        }),
      { flag: 'a' },
    );
    expect(await cache.get(path)).toMatchObject({
      lastAssistantPendingToolUse: undefined,
      asksQuestion: false,
      endedTurnAt: '2026-10-25T00:00:00Z',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

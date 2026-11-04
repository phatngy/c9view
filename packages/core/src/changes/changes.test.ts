import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { parseRecord, type TranscriptRecord } from '../transcript/index.js';
import {
  extractToolChanges,
  readFileHistory,
  sessionChanges,
} from './index.js';
import { detailedChanges, makeHunks } from './tools.js';
const secret = 'sk-ant-fixture-secret-1234567890';
function call(id: string, tool: string, input: unknown) {
  return parseRecord({
    type: 'assistant',
    cwd: '/project',
    uuid: id,
    timestamp: '2026-01-01T00:00:00Z',
    message: {
      id,
      model: 'fixture',
      content: [{ type: 'tool_use', id, name: tool, input }],
    },
  });
}
function result(id: string, value?: unknown, is_error = false) {
  return parseRecord({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, is_error, content: 'done' },
      ],
    },
    toolUseResult: value,
  });
}
describe('tool and session changes', () => {
  it('pairs results by ID, prefers structured patches and skips errors', () => {
    const records = [
      call('a', 'Edit', {
        file_path: '/project/a',
        old_string: 'wrong',
        new_string: 'wrong',
      }),
      call('bad', 'Edit', {
        file_path: '/project/b',
        old_string: 'a',
        new_string: 'b',
      }),
      result('bad', {}, true),
      result('a', {
        filePath: '/project/a',
        originalFile: 'old\n',
        structuredPatch: makeHunks('old\n', 'new\n'),
        userModified: true,
      }),
    ];
    expect(extractToolChanges(records)).toEqual([
      expect.objectContaining({
        toolUseId: 'a',
        source: 'structuredPatch',
        userModified: true,
        additions: 1,
        deletions: 1,
      }),
    ]);
  });
  it('computes MultiEdit, Write create/overwrite and Edit fallback without toolUseResult', () => {
    const records = [
      call('m', 'MultiEdit', {
        file_path: '/project/m',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
      call('w', 'Write', { file_path: '/project/new', content: 'new\n' }),
      result('w', { type: 'create' }),
      call('o', 'Write', { file_path: '/project/old', content: 'same\nnew\n' }),
      result('o', { type: 'update', originalFile: 'same\nold\n' }),
      call('e', 'Edit', {
        file_path: '/project/e',
        old_string: 'old',
        new_string: secret,
      }),
    ];
    const changes = extractToolChanges(records);
    expect(changes).toHaveLength(4);
    expect(changes[0]).toMatchObject({
      additions: 2,
      deletions: 2,
      source: 'computed',
    });
    expect(changes[1]).toMatchObject({
      kind: 'create',
      additions: 1,
      deletions: 0,
    });
    expect(changes[2]).toMatchObject({
      kind: 'update',
      additions: 1,
      deletions: 1,
    });
    expect(JSON.stringify(changes)).not.toContain(secret);
  });
  it('composes sequential hunks to cancel intermediate edits', async () => {
    const records = [
      call('a', 'Edit', {
        file_path: '/project/file',
        old_string: 'old\n',
        new_string: 'middle\n',
      }),
      call('b', 'Edit', {
        file_path: '/project/file',
        old_string: 'middle\n',
        new_string: 'old\n',
      }),
    ];
    const changes = await sessionChanges({
      claudeDir: '/nonexistent',
      root: '/project',
      sessionId: 's',
      records,
    });
    expect(changes.files[0]).toMatchObject({
      relPath: 'file',
      additions: 2,
      deletions: 2,
      toolUseIds: ['a', 'b'],
    });
    expect(
      await changes.sessionFileDiff(changes.files[0]!.fileId),
    ).toMatchObject({
      partial: true,
      source: 'tool-hunks',
      hunks: [],
      steps: expect.any(Array),
    });
  });
  it('uses snapshot/delta pre-change backups, deduplicates versions and computes net state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'c9view-history-'));
    try {
      await mkdir(join(dir, 'file-history/s'), { recursive: true });
      await writeFile(join(dir, 'file-history/s/hash@v1'), 'old\n');
      await writeFile(join(dir, 'file-history/s/hash@v2'), 'middle\n');
      const v1 = {
        version: 1,
        backupFileName: 'hash@v1',
        backupTime: '2026-01-01T00:00:00Z',
      };
      const records: TranscriptRecord[] = [
        parseRecord({
          type: 'file-history-snapshot',
          messageId: 'u',
          snapshot: { trackedFileBackups: { '/project/file': v1 } },
        }),
        call('a', 'Edit', { file_path: '/project/file' }),
        result('a', {
          originalFile: 'old\n',
          structuredPatch: makeHunks('old\n', 'middle\n'),
        }),
        parseRecord({
          type: 'file-history-delta',
          trackingPath: '/project/file',
          messageId: 'v',
          backup: {
            version: 2,
            backupFileName: 'hash@v2',
            backupTime: '2026-01-01T00:01:00Z',
          },
        }),
        call('b', 'Edit', { file_path: '/project/file' }),
        result('b', {
          originalFile: 'middle\n',
          structuredPatch: makeHunks('middle\n', `final ${secret}\n`),
        }),
        parseRecord({
          type: 'file-history-snapshot',
          snapshot: { trackedFileBackups: { '/project/file': v1 } },
        }),
      ];
      expect(
        (await readFileHistory(dir, 's', records)).get('/project/file'),
      ).toHaveLength(2);
      const changes = await sessionChanges({
        claudeDir: dir,
        sessionId: 's',
        records,
        root: '/project',
      });
      const diff = (await changes.sessionFileDiff(changes.files[0]!.fileId))!;
      expect(diff).toMatchObject({
        source: 'file-history',
        partial: false,
        additions: 1,
        deletions: 1,
      });
      expect(diff.hunks[0]?.lines).toContain('-old');
      expect(JSON.stringify(diff)).not.toContain(secret);
      expect(diff.steps).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('caps oversized tool content and rejects unsafe history references', async () => {
    const records = [
      call('large', 'Write', {
        file_path: '/project/file',
        content: 'x'.repeat(2_000_001),
      }),
    ];
    expect(extractToolChanges(records)[0]).toMatchObject({
      tooLarge: true,
      hunks: [],
    });
    const changes = await sessionChanges({
      claudeDir: '/nonexistent',
      sessionId: 's',
      records,
      root: '/project',
    });
    expect(
      (await changes.sessionFileDiff(changes.files[0]!.fileId))?.tooLarge,
    ).toBe(true);
    await expect(readFileHistory('/tmp', '../escape', [])).rejects.toThrow();
  });
});

it('uses a newer backup to retain intervening user changes before a final tool edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-checkpoint-'));
  try {
    await mkdir(join(dir, 'file-history/s'), { recursive: true });
    await writeFile(join(dir, 'file-history/s/one@v1'), 'old\n');
    await writeFile(join(dir, 'file-history/s/one@v2'), 'middle\nuser added\n');
    const records = [
      parseRecord({
        type: 'file-history-snapshot',
        snapshot: {
          messageId: 'u1',
          trackedFileBackups: {
            '/project/file': {
              version: 1,
              backupFileName: 'one@v1',
              backupTime: '2026-01-01T00:00:00Z',
            },
          },
        },
      }),
      call('a', 'Edit', {
        file_path: '/project/file',
        old_string: 'old\n',
        new_string: 'middle\n',
      }),
      parseRecord({
        type: 'user',
        uuid: 'u2',
        message: { content: 'continue' },
      }),
      parseRecord({
        type: 'file-history-delta',
        messageId: 'u2',
        trackingPath: '/project/file',
        backup: {
          version: 2,
          backupFileName: 'one@v2',
          backupTime: '2026-01-01T00:01:00Z',
        },
      }),
      call('b', 'Edit', {
        file_path: '/project/file',
        old_string: 'middle\n',
        new_string: 'final\n',
      }),
    ];
    const session = await sessionChanges({
      claudeDir: dir,
      sessionId: 's',
      root: '/project',
      records,
    });
    const diff = (await session.sessionFileDiff(session.files[0]!.fileId))!;
    expect(diff).toMatchObject({
      partial: false,
      source: 'file-history',
      additions: 2,
      deletions: 1,
    });
    expect(diff.hunks[0]?.lines).toContain('+user added');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('computes from complete result content and supports notebook cell edits', () => {
  const notebook = JSON.stringify({
    cells: [{ id: 'cell', cell_type: 'code', source: ['old\n'] }],
  });
  const records = [
    call('n', 'NotebookEdit', {
      notebook_path: '/project/a.ipynb',
      cell_id: 'cell',
      new_source: 'new\n',
    }),
    result('n', { originalFile: notebook }),
    call('e', 'Edit', { file_path: '/project/a' }),
    result('e', { originalFile: 'old\n', content: 'new\n' }),
  ];
  const changes = extractToolChanges(records);
  expect(changes[0]).toMatchObject({
    tool: 'NotebookEdit',
    additions: 1,
    deletions: 1,
  });
  expect(changes[1]).toMatchObject({
    source: 'computed',
    additions: 1,
    deletions: 1,
  });
});

it('masks multiline private keys in structured patches and omits denied file changes', () => {
  const key =
    '-----BEGIN PRIVATE KEY-----\nsynthetic-private-body\n-----END PRIVATE KEY-----\n';
  const records = [
    call('k', 'Write', { file_path: '/project/normal', content: key }),
    result('k', { type: 'create', structuredPatch: makeHunks('', key) }),
    call('d', 'Write', { file_path: '/project/.env', content: 'private' }),
  ];
  const changes = extractToolChanges(records);
  expect(changes).toHaveLength(1);
  expect(JSON.stringify(changes)).not.toContain('synthetic-private-body');
});

it('caps replacement output when replace_all expands a file beyond the content limit', () => {
  const records = [
    call('expand', 'Edit', {
      file_path: '/project/file',
      old_string: 'a',
      new_string: 'aaaa',
      replace_all: true,
    }),
    result('expand', { originalFile: 'a'.repeat(600_000) }),
  ];
  expect(extractToolChanges(records)[0]).toMatchObject({
    tooLarge: true,
    hunks: [],
  });
});

it('extracts 1000 edits on a 20k-line file under 2s and 200 MB heap growth', async () => {
  const original = 'unchanged line\n'.repeat(20_000);
  const records: TranscriptRecord[] = [];
  for (let i = 0; i < 1000; i++) {
    records.push(call(`edit-${i}`, 'Edit', { file_path: '/project/file' }));
    records.push(
      result(`edit-${i}`, {
        originalFile: `${i}\n${original}`,
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [`-${i}`, `+${i + 1}`],
          },
        ],
      }),
    );
  }
  // Materialize synthetic input strings before measuring extraction allocations.
  for (const record of records) {
    const value = record.toolUseResult as { originalFile?: string } | undefined;
    if (value?.originalFile) Buffer.byteLength(value.originalFile);
  }
  const heap = process.memoryUsage().heapUsed;
  const started = performance.now();
  const changes = await sessionChanges({
    claudeDir: '/nonexistent',
    sessionId: 's',
    root: '/project',
    records,
  });
  const diff = await changes.sessionFileDiff(changes.files[0]!.fileId);
  expect(diff?.partial).toBe(false);
  expect(diff?.additions).toBe(1);
  expect(extractToolChanges(records)).toHaveLength(1000);
  const detail = detailedChanges(records, '/project');
  expect(detailedChanges(records)).toBe(detail);
  expect(detail.filter((d) => Object.hasOwn(d, 'before'))).toHaveLength(1);
  expect(detail.filter((d) => Object.hasOwn(d, 'after'))).toHaveLength(1);
  const elapsed = performance.now() - started;
  const growth = process.memoryUsage().heapUsed - heap;
  expect(changes.files[0]?.toolUseIds).toHaveLength(1000);
  expect(elapsed).toBeLessThan(2000);
  expect(growth).toBeLessThan(200 * 1024 * 1024);
  console.info(
    `synthetic changes: 1000 edits, 20000 lines, ${elapsed.toFixed(1)} ms, ${(growth / 1024 / 1024).toFixed(1)} MB heap growth`,
  );
});

it('caps each file at 2000 steps and the session at 5000 steps with truncation', async () => {
  const records = Array.from({ length: 7500 }, (_, i) =>
    call(`${i}`, 'Edit', {
      file_path: `/project/file-${Math.floor(i / 2500)}`,
      old_string: 'a',
      new_string: 'b',
    }),
  );
  const changes = await sessionChanges({
    claudeDir: '/nonexistent',
    sessionId: 's',
    root: '/project',
    records,
  });
  expect(changes.truncated).toBe(true);
  expect(changes.files.map((f) => f.toolUseIds.length)).toEqual([
    2000, 2000, 1000,
  ]);
  for (const file of changes.files) {
    const diff = await changes.sessionFileDiff(file.fileId);
    expect(diff?.steps.length).toBeLessThanOrEqual(2000);
    expect(diff?.truncated).toBe(true);
  }
});

it('skips net diff for files over 2 MB and memoizes requested diffs', async () => {
  const records = [
    call('large', 'Edit', { file_path: '/project/large' }),
    result('large', {
      originalFile: 'x'.repeat(2_000_001),
      structuredPatch: makeHunks('a\n', 'b\n'),
    }),
  ];
  const changes = await sessionChanges({
    claudeDir: '/nonexistent',
    sessionId: 's',
    root: '/project',
    records,
  });
  const id = changes.files[0]!.fileId;
  expect(changes.sessionFileDiff(id)).toBe(changes.sessionFileDiff(id));
  expect(await changes.sessionFileDiff(id)).toMatchObject({
    tooLarge: true,
    hunks: [],
  });
});

it('keeps session changes visible for projects under .config while denying project secrets', async () => {
  const root = '/synthetic/.config/project';
  const records = [
    call('public', 'Write', {
      file_path: `${root}/id_component.ts`,
      content: 'public',
    }),
    call('private', 'Write', { file_path: `${root}/.env`, content: 'private' }),
  ];
  const changes = await sessionChanges({
    claudeDir: '/nonexistent',
    sessionId: 's',
    root,
    records,
  });
  expect(changes.files.map((f) => f.relPath)).toEqual(['id_component.ts']);
});

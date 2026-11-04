import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { listSubagents } from './subagents.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

it('links subagents through parent tool results and preserves unlinked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c9view-subagents-'));
  directories.push(root);
  const dir = join(root, 'session-1', 'subagents');
  await mkdir(dir, { recursive: true });
  await Promise.all(
    [
      'agent-alpha.jsonl',
      'agent-beta.jsonl',
      'agent-gamma.jsonl',
      'ignored.txt',
    ].map((name) => writeFile(join(dir, name), '')),
  );
  const records = [
    {
      type: 'assistant',
      message: {
        id: 'a',
        model: 'model-a',
        content: [
          {
            type: 'tool_use',
            id: 'task-1',
            name: 'Task',
            input: { description: 'Inspect tests' },
          },
        ],
      },
    },
    {
      type: 'user',
      toolUseResult: { agentId: 'alpha' },
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'task-1', content: 'Done' },
        ],
      },
    },
    {
      type: 'user',
      toolUseResult: { agentId: 'gamma', description: 'Inspect source' },
      message: { content: [{ type: 'tool_result', tool_use_id: 'task-2' }] },
    },
  ];
  await writeFile(
    join(root, 'session-1.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  expect(await listSubagents(root, 'session-1')).toEqual([
    {
      agentId: 'alpha',
      path: join(dir, 'agent-alpha.jsonl'),
      parentToolUseId: 'task-1',
      description: 'Inspect tests',
    },
    { agentId: 'beta', path: join(dir, 'agent-beta.jsonl') },
    {
      agentId: 'gamma',
      path: join(dir, 'agent-gamma.jsonl'),
      parentToolUseId: 'task-2',
      description: 'Inspect source',
    },
  ]);
  expect(await listSubagents(root, 'missing')).toEqual([]);
  await rm(join(root, 'session-1.jsonl'));
  expect(await listSubagents(root, 'session-1')).toHaveLength(3);
});

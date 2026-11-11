import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Requests } from './requests.js';
import { FakeSdk } from './fake-sdk.js';
import { Queue } from './queue.js';
import type { UserInput } from './sdk.js';
afterEach(() => vi.useRealTimers());
async function setup(timeout = 1000) {
  const requests = new Requests(
    timeout,
    () => {},
    () => {},
  );
  const fake = new FakeSdk();
  const queue = new Queue<UserInput>();
  const run = await fake.adapter(queue, {
    cwd: '/synthetic',
    sessionId: 'session',
    permissionMode: 'default',
    env: {},
    pathToClaudeCodeExecutable: '/fake/claude',
    canUseTool: requests.handler('run', () => 'session'),
    abortController: new AbortController(),
  });
  return {
    requests,
    fake,
    run,
    close: () => {
      requests.close();
      run.close();
      queue.close();
    },
  };
}
it('T025 T026 retains server input, redacts cards, and decides only once', async () => {
  const t = await setup();
  try {
    const result = t.fake.runs[0]!.permission('Bash', {
      command: 'echo sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
    });
    const card = t.requests.snapshot()[0]!;
    expect(JSON.stringify(card)).not.toContain(
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
    );
    t.requests.decide(card.requestId, {
      clientRequestId: randomUUID(),
      decision: 'allow',
      ...{ input: { command: 'browser forged' } },
    });
    expect(await result).toMatchObject({
      updatedInput: {
        command: 'echo sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
      },
    });
    expect(() =>
      t.requests.decide(card.requestId, {
        clientRequestId: randomUUID(),
        decision: 'deny',
      }),
    ).toThrow('already decided');
  } finally {
    t.close();
  }
});
it('T025 expires or aborts pending approvals with a denial', async () => {
  vi.useFakeTimers();
  const t = await setup(100);
  try {
    const result = t.fake.runs[0]!.permission('Bash', {});
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({
      behavior: 'deny',
      message: 'No answer from the c9view user',
    });
    const abort = new AbortController();
    const pending = t.fake.runs[0]!.permission('Bash', {}, abort.signal);
    abort.abort();
    expect(await pending).toMatchObject({ behavior: 'deny' });
    expect(t.requests.snapshot()).toEqual([]);
  } finally {
    t.close();
  }
});
it('T025 validates question cardinality and bounded Other answers while preserving original questions', async () => {
  const t = await setup();
  try {
    const input = {
      questions: [
        {
          question: 'Pick?',
          header: 'Choice',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    };
    const result = t.fake.runs[0]!.permission('AskUserQuestion', input);
    const id = t.requests.snapshot()[0]!.requestId;
    const command = { clientRequestId: randomUUID() };
    expect(() =>
      t.requests.decide(id, { ...command, answers: { 'Pick?': ['A', 'B'] } }),
    ).toThrow('Invalid answer');
    expect(() =>
      t.requests.decide(id, {
        ...command,
        answers: { 'Pick?': 'x'.repeat(2001) },
      }),
    ).toThrow('Invalid answer');
    t.requests.decide(id, {
      ...command,
      answers: { 'Pick?': 'Other response' },
    });
    expect(await result).toEqual({
      behavior: 'allow',
      updatedInput: { ...input, answers: { 'Pick?': 'Other response' } },
    });
  } finally {
    t.close();
  }
});
it('T025 maps redacted option labels back to the server-held originals', async () => {
  const t = await setup();
  try {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789';
    const question = `Choose ${secret}?`;
    const result = t.fake.runs[0]!.permission('AskUserQuestion', {
      questions: [
        {
          question,
          header: 'Choice',
          options: [
            { label: secret, description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    });
    const card = t.requests.snapshot()[0]!;
    if (card.kind !== 'question') throw new Error('Expected question');
    const visible = card.questions[0]!;
    t.requests.decide(card.requestId, {
      clientRequestId: randomUUID(),
      answers: { [visible.question]: visible.options[0]!.label },
    });
    expect(await result).toMatchObject({
      updatedInput: { answers: { [question]: secret } },
    });
  } finally {
    t.close();
  }
});
it('T095 builds a bounded tool-row summary from relevant fields, not raw JSON', async () => {
  const t = await setup();
  try {
    void t.fake.runs[0]!.permission('Edit', {
      file_path: '/synthetic/a.ts',
      old_string: 'x',
      new_string: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
      secret: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
    });
    void t.fake.runs[0]!.permission('Bash', { command: 'x'.repeat(5000) });
    const [edit, bash] = t.requests.snapshot();
    if (edit?.kind !== 'permission' || bash?.kind !== 'permission')
      throw new Error('expected permission cards');
    expect(edit.summary).toMatch(/^Edit: \/synthetic\/a\.ts\nline 0/);
    expect(edit.summary).not.toContain('{');
    expect(edit.summary).not.toContain('sk-ant');
    expect(edit.summary).not.toContain('line 19');
    expect(bash.summary.length).toBeLessThanOrEqual(600);
  } finally {
    t.close();
  }
});

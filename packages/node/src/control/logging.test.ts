import { expect, it, vi } from 'vitest';
import { setupControl, tick } from './test-support.js';
it('T036 never logs prompts/tool inputs/answers and redacts SDK errors', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const t = await setupControl(
    {},
    {
      liveness: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new Error('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789'),
        ),
    },
  );
  try {
    const receipt = await t.service.reply(
      'project',
      'session',
      t.body(),
      t.bootId,
    );
    await tick();
    expect(t.service.receipt(receipt.clientRequestId)?.error).not.toContain(
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
    );
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  } finally {
    await t.close();
    error.mockRestore();
    log.mockRestore();
  }
});
it('T036 tool input and question answers never enter logs', async () => {
  const t = await setupControl();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await t.service.start('project', t.body(), t.bootId);
    await tick();
    const question = t.sdk.runs[0]!.permission('AskUserQuestion', {
      questions: [
        {
          question: 'Synthetic question?',
          header: 'Question',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    });
    const request = t.service.snapshot().requests[0]!;
    const { randomUUID } = await import('node:crypto');
    await t.service.decide(
      request.requestId,
      {
        clientRequestId: randomUUID(),
        answers: { 'Synthetic question?': 'synthetic private answer' },
      },
      t.bootId,
    );
    await question;
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  } finally {
    await t.close();
    error.mockRestore();
    log.mockRestore();
  }
});

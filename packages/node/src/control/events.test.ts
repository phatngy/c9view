import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupControl, tick } from './test-support.js';
it('T028 run and request events contain only contract IDs', async () => {
  const t = await setupControl();
  const seen: unknown[] = [];
  t.store.events.subscribe((event) => seen.push(event));
  try {
    const receipt = await t.service.start('project', t.body(), t.bootId);
    await tick();
    const run = t.sdk.runs[0]!;
    run.init(receipt.sessionId);
    await tick();
    const result = run.permission('Bash', { command: 'synthetic tool input' });
    await tick();
    const id = t.service.snapshot().requests[0]!.requestId;
    await t.service.decide(
      id,
      { clientRequestId: randomUUID(), decision: 'allow' },
      t.bootId,
    );
    await result;
    expect(seen.length).toBeGreaterThan(2);
    for (const event of seen as {
      event: string;
      data: Record<string, string>;
    }[]) {
      const allowed =
        event.event === 'control.run'
          ? ['runId', 'sessionId', 'projectId']
          : event.event === 'control.request'
            ? ['requestId', 'runId', 'sessionId']
            : ['requestId'];
      expect(Object.keys(event.data).sort()).toEqual(allowed.sort());
    }
    expect(JSON.stringify(seen)).not.toContain('synthetic');
  } finally {
    await t.close();
  }
});

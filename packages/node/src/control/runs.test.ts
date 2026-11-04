import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupControl, tick } from './test-support.js';
it('T019 accepts simultaneous replies into one run and completes every queued receipt', async () => {
  const t = await setupControl();
  try {
    const bodies = [t.body(), t.body()];
    const receipts = await Promise.all(
      bodies.map((body) =>
        t.service.reply('project', 'session', body, t.bootId),
      ),
    );
    await tick();
    expect(new Set(receipts.map((receipt) => receipt.runId)).size).toBe(1);
    expect(t.sdk.runs).toHaveLength(1);
    const run = t.sdk.runs[0]!;
    run.init('session');
    await tick();
    run.result();
    run.result();
    await tick();
    expect(
      bodies.map((body) => t.service.receipt(body.clientRequestId)?.status),
    ).toEqual(['done', 'done']);
  } finally {
    await t.close();
  }
});
it('T022 mode and interrupt during delayed startup wait for the actual runner', async () => {
  const t = await setupControl();
  let release!: () => void;
  t.sdk.startDelay = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const receipt = await t.service.start('project', t.body(), t.bootId);
    const change = t.service.setMode(
      receipt.runId!,
      { clientRequestId: randomUUID(), mode: 'plan' },
      t.bootId,
    );
    const interrupt = t.service.interrupt(
      receipt.runId!,
      { clientRequestId: randomUUID() },
      t.bootId,
    );
    release();
    await Promise.all([change, interrupt]);
    expect(t.sdk.runs[0]!.modes).toEqual(['plan']);
    expect(t.sdk.runs[0]!.interrupts).toBe(1);
  } finally {
    release();
    await t.close();
  }
});
it('T019 shutdown before scheduled launch starts no process', async () => {
  const t = await setupControl();
  try {
    await t.service.start('project', t.body(), t.bootId);
    await t.service.close();
    expect(t.sdk.runs).toHaveLength(0);
  } finally {
    await t.close();
  }
});

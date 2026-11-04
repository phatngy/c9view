import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupControl, tick } from './test-support.js';
it('T019 accepts simultaneous replies into one run and completes every queued receipt', async () => {
  const t = await setupControl();
  try {
    const bodies = [
      { ...t.body(), text: 'first' },
      { ...t.body(), text: 'second' },
    ];
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
    expect(run.inputs.map((input) => input.message.content)).toEqual([
      'first',
      'second',
    ]);
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
    const body = t.body();
    await t.service.start('project', body, t.bootId);
    await t.service.close();
    expect(t.sdk.runs).toHaveLength(0);
    expect(t.service.receipt(body.clientRequestId)).toMatchObject({
      status: 'failed',
      error: 'Run stopped before the message was delivered',
    });
  } finally {
    await t.close();
  }
});

it.each(['stop', 'shutdown'] as const)(
  'fails dropped queued receipts on %s and preserves the completed turn',
  async (action) => {
    const t = await setupControl();
    try {
      const first = t.body();
      const receipt = await t.service.reply(
        'project',
        'session',
        first,
        t.bootId,
      );
      await tick();
      const runner = t.sdk.runs[0]!;
      runner.init('session');
      runner.result();
      await tick();
      const second = t.body();
      await t.service.reply('project', 'session', second, t.bootId);
      if (action === 'stop')
        await t.service.stop(
          receipt.runId!,
          { clientRequestId: randomUUID() },
          t.bootId,
        );
      else await t.service.close();
      expect(t.service.receipt(first.clientRequestId)?.status).toBe('done');
      expect(t.service.receipt(second.clientRequestId)).toMatchObject({
        status: 'failed',
        error: 'Run stopped before the message was delivered',
      });
    } finally {
      await t.close();
    }
  },
);

it('times out a fake SDK that never emits init and frees the run slot', async () => {
  const t = await setupControl({ maxRuns: 1, idleMin: 0.002 });
  try {
    const body = t.body();
    await t.service.start('project', body, t.bootId);
    await tick();
    await tick();
    expect(t.service.receipt(body.clientRequestId)).toMatchObject({
      status: 'failed',
      error: 'Claude Code did not start before the timeout',
    });
    expect(t.sdk.runs[0]!.closed).toBe(true);
    await expect(
      t.service.start('project', t.body(), t.bootId),
    ).resolves.toMatchObject({ status: 'accepted' });
  } finally {
    await t.close();
  }
});

it('an interrupted error result ends the turn and keeps the fake SDK run open for another reply', async () => {
  const t = await setupControl();
  try {
    const body = t.body();
    const receipt = await t.service.reply('project', 'session', body, t.bootId);
    await tick();
    const runner = t.sdk.runs[0]!;
    runner.init('session');
    await tick();
    await t.service.interrupt(
      receipt.runId!,
      { clientRequestId: randomUUID() },
      t.bootId,
    );
    runner.messages.push({ type: 'result', is_error: true });
    await tick();
    expect(t.service.snapshot().runs[0]!.state).toBe('idle');
    expect(t.service.receipt(body.clientRequestId)?.status).toBe('done');
    expect(runner.closed).toBe(false);
    const next = t.body();
    await t.service.reply('project', 'session', next, t.bootId);
    await tick();
    runner.result();
    await tick();
    expect(t.sdk.runs).toHaveLength(1);
    expect(runner.inputs).toHaveLength(2);
    expect(t.service.receipt(next.clientRequestId)?.status).toBe('done');
  } finally {
    await t.close();
  }
});

it('rechecks session ownership after interleaved preflight awaits and joins in delivery order', async () => {
  const releases: (() => void)[] = [];
  let firstEntered!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let both!: () => void;
  const entered = new Promise<void>((resolve) => {
    both = resolve;
  });
  let calls = 0;
  const t = await setupControl(
    {},
    {
      liveness: async () => {
        if (++calls > 2) return;
        await new Promise<void>((resolve) => {
          releases.push(resolve);
          if (releases.length === 1) firstEntered();
          if (releases.length === 2) both();
        });
      },
    },
  );
  try {
    const first = t.service.reply(
      'project',
      'session',
      { ...t.body(), text: 'first' },
      t.bootId,
    );
    await firstGate;
    const second = t.service.reply(
      'project',
      'session',
      { ...t.body(), text: 'second' },
      t.bootId,
    );
    await entered;
    releases[0]!();
    const a = await first;
    releases[1]!();
    const b = await second;
    expect(a.runId).toBe(b.runId);
    await tick();
    expect(t.sdk.runs).toHaveLength(1);
    expect(t.sdk.runs[0]!.inputs.map((input) => input.message.content)).toEqual(
      ['first', 'second'],
    );
  } finally {
    for (const release of releases) release();
    await t.close();
  }
});

import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setupControl, tick } from './test-support.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(...args: Parameters<typeof setupControl>) {
  const test = await setupControl(...args);
  cleanup.push(test.close);
  return test;
}
it('T021 T029 T037 accepts before SDK start, reserves generated ID/name and recovers receipts', async () => {
  const t = await setup();
  let release!: () => void;
  t.sdk.startDelay = new Promise((resolve) => {
    release = resolve;
  });
  const body = { ...t.body(), name: 'Synthetic name' };
  const receipt = await t.service.start('project', body, t.bootId);
  expect(receipt.status).toBe('accepted');
  expect(receipt.sessionId).toMatch(/^[a-f0-9-]{36}$/);
  expect(t.sdk.runs).toHaveLength(0);
  expect(await t.service.start('project', body, t.bootId)).toEqual(receipt);
  expect(t.service.receipt(body.clientRequestId)).toEqual(receipt);
  release();
  await tick();
  expect(t.sdk.runs).toHaveLength(1);
  expect(t.sdk.runs[0]!.options.extraArgs).toEqual({ name: body.name });
  t.sdk.runs[0]!.init(receipt.sessionId);
  await tick();
  expect(t.service.snapshot().runs[0]!.state).toBe('running');
});
it('T019 T022 joins a run stream and queues while busy; idle timeout closes', async () => {
  const t = await setup({ idleMin: 0.002 });
  await t.service.reply('project', 'session', t.body(), t.bootId);
  await tick();
  const run = t.sdk.runs[0]!;
  run.init('session');
  await tick();
  await t.service.reply('project', 'session', t.body(), t.bootId);
  await tick();
  expect(t.sdk.runs).toHaveLength(1);
  expect(run.inputs).toHaveLength(2);
  expect(t.service.snapshot().runs[0]!.queued).toBe(1);
  run.result(0.12);
  run.result(0.25);
  await tick();
  expect(t.service.snapshot().runs[0]!.costUsd).toBe(0.25);
  await tick();
  await tick();
  expect(run.closed).toBe(true);
});
it('T019 enforces run cap before spawning and closes all on shutdown', async () => {
  const t = await setup({ maxRuns: 1 });
  await t.service.start('project', t.body(), t.bootId);
  await tick();
  await expect(
    t.service.start('project', t.body(), t.bootId),
  ).rejects.toMatchObject({ status: 429 });
  await t.service.close();
  expect(t.sdk.runs[0]!.closed).toBe(true);
});
it('T021 fork uses SDK forkSession and follows init session ID into the receipt', async () => {
  const t = await setup();
  const body = { ...t.body(), fork: true };
  await t.service.reply('project', 'session', body, t.bootId);
  await tick();
  const run = t.sdk.runs[0]!;
  expect(run.options).toMatchObject({ resume: 'session', forkSession: true });
  run.init('forked-session');
  await tick();
  expect(t.service.receipt(body.clientRequestId)?.sessionId).toBe(
    'forked-session',
  );
});
it('T020 checks liveness twice and never spawns after a conflicting second check', async () => {
  const liveness = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('live elsewhere'));
  const t = await setup({}, { liveness });
  const body = t.body();
  const receipt = await t.service.reply('project', 'session', body, t.bootId);
  expect(receipt.status).toBe('accepted');
  await tick();
  expect(liveness).toHaveBeenCalledTimes(2);
  expect(t.sdk.runs).toHaveLength(0);
  expect(t.service.receipt(body.clientRequestId)?.status).toBe('failed');
});
it('T027 decisions, mode, interrupt and stop use receipts', async () => {
  const t = await setup();
  const receipt = await t.service.start('project', t.body(), t.bootId);
  await tick();
  const run = t.sdk.runs[0]!;
  run.init(receipt.sessionId);
  await tick();
  const decision = run.permission('Bash', { command: 'synthetic' });
  await tick();
  const request = t.service.snapshot().requests[0]!;
  const body = { clientRequestId: randomUUID(), decision: 'allow' as const };
  const a = await t.service.decide(request.requestId, body, t.bootId);
  expect(await t.service.decide(request.requestId, body, t.bootId)).toEqual(a);
  expect(await decision).toEqual({
    behavior: 'allow',
    updatedInput: { command: 'synthetic' },
  });
  await expect(
    t.service.decide(
      request.requestId,
      { ...body, clientRequestId: randomUUID() },
      t.bootId,
    ),
  ).rejects.toMatchObject({ reason: 'decided' });
  await t.service.setMode(
    receipt.runId!,
    { clientRequestId: randomUUID(), mode: 'plan' },
    t.bootId,
  );
  expect(run.modes).toEqual(['plan']);
  await t.service.interrupt(
    receipt.runId!,
    { clientRequestId: randomUUID() },
    t.bootId,
  );
  expect(run.interrupts).toBe(1);
  await t.service.stop(
    receipt.runId!,
    { clientRequestId: randomUUID() },
    t.bootId,
  );
  expect(run.closed).toBe(true);
});
it('T030 T033 default settings bypass is downgraded; node bypass forces all three run types', async () => {
  const t = await setup();
  await mkdir(join(t.folder, '.claude'));
  await writeFile(
    join(t.folder, '.claude/settings.json'),
    JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }),
  );
  await t.service.start('project', t.body(), t.bootId);
  await tick();
  expect(t.sdk.runs[0]!.options.permissionMode).toBe('default');
  const bypass = await setup({ bypass: true });
  await bypass.service.start('project', bypass.body(), bypass.bootId);
  await bypass.service.reply(
    'project',
    'session',
    bypass.body(),
    bypass.bootId,
  );
  await bypass.service.reply(
    'project',
    'session',
    { ...bypass.body(), fork: true },
    bypass.bootId,
  );
  await tick();
  expect(bypass.sdk.runs.map((r) => r.options.permissionMode)).toEqual([
    'bypassPermissions',
    'bypassPermissions',
    'bypassPermissions',
  ]);
  expect(bypass.service.capability.bypass).toBe(true);
  await expect(
    bypass.service.setMode(
      bypass.service.snapshot().runs[0]!.runId,
      { clientRequestId: randomUUID(), mode: 'default' },
      bypass.bootId,
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it('T021 retry from a previous boot cannot act', async () => {
  const t = await setup();
  await expect(
    t.service.start('project', t.body(), randomUUID()),
  ).rejects.toMatchObject({ reason: 'unknown-outcome' });
  expect(t.sdk.runs).toHaveLength(0);
});
it('T009 target identifiers participate in the operation fingerprint', async () => {
  const t = await setup();
  const body = t.body();
  await t.service.start('project', body, t.bootId);
  await expect(
    t.service.start('another-project', body, t.bootId),
  ).rejects.toMatchObject({ reason: 'payload-mismatch' });
});
it('T091 tombstone saturation refuses new mutations and advertises unavailable', async () => {
  const t = await setup({ receiptMin: 0.000001, tombstoneMax: 3 });
  const commands = [t.body(), t.body(), t.body()];
  for (const body of commands) await t.service.start('project', body, t.bootId);
  await tick();
  await expect(
    t.service.start('project', t.body(), t.bootId),
  ).rejects.toMatchObject({ reason: 'unknown-outcome' });
  await expect(
    t.service.start('project', commands[0]!, t.bootId),
  ).rejects.toMatchObject({ reason: 'unknown-outcome' });
  expect(t.service.capability).toMatchObject({
    state: 'unavailable',
    reason: 'restart the node to accept new commands',
  });
  expect(t.sdk.runs).toHaveLength(3);
});
it('T024 fork is permitted when the original is held by a terminal process', async () => {
  const liveness = vi.fn(async () => {
    throw new Error('live elsewhere');
  });
  const t = await setup({}, { liveness });
  const body = { ...t.body(), fork: true };
  const receipt = await t.service.reply('project', 'session', body, t.bootId);
  expect(receipt).not.toHaveProperty('sessionId');
  await tick();
  expect(liveness).not.toHaveBeenCalled();
  expect(t.sdk.runs[0]!.options).toMatchObject({
    resume: 'session',
    forkSession: true,
  });
});

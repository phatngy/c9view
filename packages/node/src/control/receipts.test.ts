import { describe, it, expect, vi } from 'vitest';
import { Receipts } from './receipts.js';

describe('T009 T091 reservations', () => {
  it('joins in flight, fingerprints sorted bodies, and refuses payload changes', async () => {
    const receipts = new Receipts('boot', 1000, 10);
    let release!: () => void;
    const action = vi.fn(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { status: 'done' as const };
    });
    const a = receipts.run('reply', 'id', { b: 2, a: 1 }, 'boot', action);
    const b = receipts.run('reply', 'id', { a: 1, b: 2 }, 'old', action);
    await expect(
      receipts.run('reply', 'id', { a: 3 }, 'boot', action),
    ).rejects.toMatchObject({ reason: 'payload-mismatch' });
    await Promise.resolve();
    release();
    expect(await a).toEqual(await b);
    expect(action).toHaveBeenCalledTimes(1);
  });
  it('expires to boot-long tombstones and saturates without eviction', async () => {
    let now = 0;
    const receipts = new Receipts('boot', 10, 3, () => now);
    const action = vi.fn(async () => ({ status: 'done' as const }));
    for (const id of ['a', 'b', 'c'])
      await receipts.run('reply', id, {}, 'boot', action);
    now = 11;
    expect(receipts.get('a')).toBeUndefined();
    await expect(
      receipts.run('reply', 'a', {}, 'boot', action),
    ).rejects.toMatchObject({ reason: 'unknown-outcome' });
    await expect(
      receipts.run('reply', 'd', {}, 'boot', action),
    ).rejects.toMatchObject({ reason: 'unknown-outcome' });
    expect(receipts.unavailable).toContain('restart the node');
    expect(action).toHaveBeenCalledTimes(3);
  });
  it('never acts on an unknown key from another boot', async () => {
    const action = vi.fn();
    await expect(
      new Receipts('new', 10, 10).run('reply', 'id', {}, 'old', action),
    ).rejects.toMatchObject({ reason: 'unknown-outcome' });
    expect(action).not.toHaveBeenCalled();
  });
});
it('fingerprints a nested question named clientRequestId', async () => {
  const receipts = new Receipts('boot', 100, 10);
  const action = async () => ({ status: 'done' as const });
  await receipts.run(
    'decide',
    'id',
    { clientRequestId: 'id', answers: { clientRequestId: 'A' } },
    'boot',
    action,
  );
  await expect(
    receipts.run(
      'decide',
      'id',
      { clientRequestId: 'id', answers: { clientRequestId: 'B' } },
      'boot',
      action,
    ),
  ).rejects.toMatchObject({ reason: 'payload-mismatch' });
});
it('M2 a cloning receipt does not expire, and its TTL counts from the last update', async () => {
  let now = 0;
  const receipts = new Receipts('boot', 1000, 100, () => now);
  const id = 'c1';
  await receipts.run('project', id, {}, 'boot', async () => ({
    status: 'cloning',
  }));
  now = 10_000;
  expect(receipts.get(id)?.status).toBe('cloning');
  receipts.update('project', id, { status: 'ready' });
  now = 10_900;
  expect(receipts.get(id)?.status).toBe('ready');
  receipts.update('project', id, { status: 'ready' });
  now = 11_800;
  expect(receipts.get(id)?.status).toBe('ready');
  now = 13_000;
  expect(receipts.get(id)).toBeUndefined();
});

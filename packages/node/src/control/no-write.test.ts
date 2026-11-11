import { expect, it } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupControl, waitFor } from './test-support.js';
async function tree(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isDirectory())
    return [info.mtimeMs, (await readFile(path)).toString('hex')];
  const entries = await readdir(path);
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((name) => name !== 'c9view')
        .map(async (name) => [name, await tree(join(path, name))]),
    ),
  );
}
it('T035 all control operations leave Claude data and project files unchanged', async () => {
  const t = await setupControl();
  try {
    const before = await tree(t.root);
    const { FolderTrust } = await import('./trust.js');
    const trust = await new FolderTrust(t.claudeDir, {
      trusted: () => false,
      trust: () => {},
      close: () => {},
    }).summary(t.folder);
    await t.service.trust(
      {
        clientRequestId: randomUUID(),
        path: t.folder,
        fingerprint: trust.fingerprint,
      },
      t.bootId,
    );
    const receipt = await t.service.reply(
      'project',
      'session',
      t.body(),
      t.bootId,
    );
    await waitFor(() => expect(t.sdk.runs).toHaveLength(1));
    const run = t.sdk.runs[0]!;
    run.init('session');
    await waitFor(() =>
      expect(t.service.snapshot().runs[0]?.state).toBe('running'),
    );
    const permission = run.permission('Read', { path: 'synthetic.txt' });
    await waitFor(() => expect(t.service.snapshot().requests).toHaveLength(1));
    await t.service.decide(
      t.service.snapshot().requests[0]!.requestId,
      {
        clientRequestId: randomUUID(),
        decision: 'deny',
        message: 'synthetic answer',
      },
      t.bootId,
    );
    await permission;
    await t.service.setMode(
      receipt.runId!,
      { clientRequestId: randomUUID(), mode: 'plan' },
      t.bootId,
    );
    await t.service.interrupt(
      receipt.runId!,
      { clientRequestId: randomUUID() },
      t.bootId,
    );
    await t.service.stop(
      receipt.runId!,
      { clientRequestId: randomUUID() },
      t.bootId,
    );
    await t.service.start('project', t.body(), t.bootId);
    await waitFor(() => expect(t.sdk.runs).toHaveLength(2));
    t.service.snapshot();
    t.service.receipt(receipt.clientRequestId);
    await t.service.close();
    expect(await tree(t.root)).toEqual(before);
  } finally {
    await t.close();
  }
});
it('T035 rejects state paths whose symlinked ancestors point into a project', async () => {
  const t = await setupControl();
  try {
    const { symlink } = await import('node:fs/promises');
    const { assertStateLocation } = await import('./trust.js');
    await symlink(t.folder, join(t.root, 'alias'));
    expect(() =>
      assertStateLocation(join(t.root, 'alias/state'), t.claudeDir, [t.folder]),
    ).toThrow('C9VIEW_STATE_DIR');
  } finally {
    await t.close();
  }
});

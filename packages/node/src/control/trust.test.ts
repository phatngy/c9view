import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupControl, tick } from './test-support.js';
import type { ControlError } from './errors.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
it('T031 T032 untrusted folder summary is redacted, stale trust refused, changes invalidate consent', async () => {
  const t = await setupControl({}, { trusted: false });
  cleanups.push(t.close);
  await mkdir(join(t.folder, '.claude'));
  await writeFile(
    join(t.folder, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'echo sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
              },
            ],
          },
        ],
      },
      permissions: { allow: ['Read'] },
    }),
  );
  const first = (await t.service
    .start('project', t.body(), t.bootId)
    .catch((error) => error as ControlError)) as ControlError;
  expect(first.reason).toBe('untrusted-folder');
  expect(first.trust?.allowRules).toEqual(['Read']);
  expect(JSON.stringify(first.trust)).not.toContain(
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789',
  );
  expect(t.sdk.runs).toHaveLength(0);
  const trust = first.trust!;
  await writeFile(join(t.folder, '.claude/settings.local.json'), '{}');
  const changed = (await t.service
    .trust(
      {
        clientRequestId: randomUUID(),
        path: t.folder,
        fingerprint: trust.fingerprint,
      },
      t.bootId,
    )
    .catch((error) => error as ControlError)) as ControlError;
  expect(changed.reason).toBe('settings-changed');
  await t.service.trust(
    {
      clientRequestId: randomUUID(),
      path: t.folder,
      fingerprint: changed.trust!.fingerprint,
    },
    t.bootId,
  );
  const receipt = await t.service.start('project', t.body(), t.bootId);
  await tick();
  expect(t.sdk.runs).toHaveLength(1);
  await t.service.stop(
    receipt.runId!,
    { clientRequestId: randomUUID() },
    t.bootId,
  );
  await writeFile(
    join(t.folder, '.claude/settings.local.json'),
    '{"permissions":{"allow":["Bash"]}}',
  );
  await expect(
    t.service.start('project', t.body(), t.bootId),
  ).rejects.toMatchObject({ reason: 'untrusted-folder' });
});
it('T031 reads Claude trust without modifying the file', async () => {
  const t = await setupControl();
  cleanups.push(t.close);
  const path = join(t.root, '.claude.json');
  const before = await readFile(path);
  await t.service.start('project', t.body(), t.bootId);
  await tick();
  expect(t.sdk.runs).toHaveLength(1);
  expect(await readFile(path)).toEqual(before);
});

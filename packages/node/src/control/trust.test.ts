import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setupControl, waitFor } from './test-support.js';
import type { ControlError } from './errors.js';
import { FolderTrust } from './trust.js';
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
  await waitFor(() => expect(t.sdk.runs).toHaveLength(1));
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
  await waitFor(() => expect(t.sdk.runs).toHaveLength(1));
  expect(await readFile(path)).toEqual(before);
});

it('ignores Claude Code bookkeeping in ~/.claude.json and marketplaces, not MCP or tool changes', async () => {
  const { FolderTrust } = await import('./trust.js');
  const { dirname, resolve } = await import('node:path');
  const t = await setupControl({}, { trusted: false });
  cleanups.push(t.close);
  const trust = new FolderTrust(t.claudeDir, {
    trusted: () => false,
    trust: () => {},
    close: () => {},
  });
  const globalConfig = join(dirname(resolve(t.claudeDir)), '.claude.json');
  const marketplaces = join(t.claudeDir, 'plugins/known_marketplaces.json');
  await mkdir(dirname(marketplaces), { recursive: true });
  const config = (extra: Record<string, unknown>, mcp = {}) =>
    writeFile(
      globalConfig,
      JSON.stringify({
        numStartups: 1,
        mcpServers: mcp,
        projects: { [t.folder]: { allowedTools: [], lastCost: 0, ...extra } },
      }),
    );
  const market = (lastUpdated: string, source = 'github:synthetic/market') =>
    writeFile(
      marketplaces,
      JSON.stringify({
        synthetic: { source, installLocation: '/synthetic', lastUpdated },
      }),
    );
  await config({});
  await market('2026-01-01T00:00:00Z');
  const base = (await trust.summary(t.folder)).fingerprint;
  // What Claude Code rewrites on every start and every run.
  await writeFile(
    globalConfig,
    JSON.stringify({
      numStartups: 99,
      tipsHistory: { synthetic: 3 },
      mcpServers: {},
      projects: {
        [t.folder]: { allowedTools: [], lastCost: 1.5, lastSessionId: 'x' },
        '/synthetic/other': { lastCost: 9 },
      },
    }),
  );
  await market('2026-02-02T00:00:00Z');
  expect((await trust.summary(t.folder)).fingerprint).toBe(base);
  // What changes what a session in this folder can run.
  await config({ allowedTools: ['Bash(rm:*)'] });
  const tools = (await trust.summary(t.folder)).fingerprint;
  expect(tools).not.toBe(base);
  await config({}, { synthetic: { command: 'synthetic-server' } });
  expect((await trust.summary(t.folder)).fingerprint).not.toBe(base);
  await config({});
  await market('2026-01-01T00:00:00Z', 'github:synthetic/other');
  expect((await trust.summary(t.folder)).fingerprint).not.toBe(base);
  // An unparsable file is hashed whole: any change prompts again.
  await writeFile(globalConfig, '{not json');
  const broken = (await trust.summary(t.folder)).fingerprint;
  await writeFile(globalConfig, '{not json!');
  expect((await trust.summary(t.folder)).fingerprint).not.toBe(broken);
});

it('accepts a known project symlink by realpath and ignores timestamp-only changes', async () => {
  const { symlink, utimes } = await import('node:fs/promises');
  const { FolderTrust } = await import('./trust.js');
  const t = await setupControl({}, { trusted: false });
  cleanups.push(t.close);
  const file = join(t.folder, 'CLAUDE.md');
  await writeFile(file, 'synthetic instructions');
  const records = new Map<string, string>();
  const trust = new FolderTrust(t.claudeDir, {
    trusted: (path, fingerprint) => records.get(path) === fingerprint,
    trust: (path, fingerprint) => {
      records.set(path, fingerprint);
    },
    close: () => {},
  });
  const summary = await trust.summary(t.folder);
  await utimes(file, new Date(0), new Date(0));
  expect((await trust.summary(t.folder)).fingerprint).toBe(summary.fingerprint);
  const link = join(t.root, 'project-link');
  await symlink(t.folder, link);
  await trust.accept(link, summary.fingerprint, [t.folder]);
  await expect(trust.check(link)).resolves.toMatchObject({ path: t.folder });
  await expect(
    trust.accept(join(t.root, 'missing'), summary.fingerprint, [t.folder]),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    trust.accept(t.root, summary.fingerprint, [t.folder]),
  ).rejects.toMatchObject({ status: 404 });
});
it('accept refuses a known folder that no longer exists with the normal refusal', async () => {
  const t = await setupControl();
  try {
    await expect(
      new FolderTrust(t.claudeDir, {
        trusted: () => false,
        trust: () => {},
        close: () => {},
      } as never).accept(t.folder, 'a'.repeat(64), [join(t.root, 'gone')]),
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    await t.close();
  }
});

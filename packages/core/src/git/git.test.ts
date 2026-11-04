import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  writeFile,
  appendFile,
  mkdir,
  chmod,
  access,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createGit } from './index.js';

it.each([
  'fsmonitor',
  'clean',
  'smudge',
  'process',
  'include',
  'textconv',
  'external',
  'pager',
  'hooks',
  'parent-env',
  'config-env',
])('never executes repository commands: %s', async (vector) => {
  const root = await mkdtemp(join(tmpdir(), 'c9view-git-security-'));
  const marker = join(root, 'marker');
  const command = `touch ${marker}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        ...args,
      ],
      { cwd: root },
    );
  try {
    git('init', '-q');
    await writeFile(join(root, 'file'), 'before\n');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    await writeFile(join(root, 'file'), 'after\n');
    await writeFile(join(root, 'untracked'), 'new\n');
    await writeFile(join(root, '.gitattributes'), '* filter=evil diff=evil\n');
    if (vector === 'fsmonitor') git('config', 'core.fsmonitor', command);
    if (['clean', 'smudge', 'process'].includes(vector)) {
      git('config', `filter.evil.${vector}`, command);
      git('config', 'filter.evil.required', 'true');
    }
    if (vector === 'include') {
      await writeFile(
        join(root, '.git/evil.cfg'),
        `[filter "evil"]\nclean = ${command}\nsmudge = ${command}\nprocess = ${command}\nrequired = true\n`,
      );
      await appendFile(
        join(root, '.git/config'),
        '\n[include]\npath = ./evil.cfg\n',
      );
    }
    if (vector === 'textconv') git('config', 'diff.evil.textconv', command);
    if (vector === 'external') git('config', 'diff.external', command);
    if (vector === 'pager') git('config', 'core.pager', command);
    if (vector === 'hooks') {
      const hooks = join(root, 'hooks');
      await mkdir(hooks);
      for (const name of [
        'post-index-change',
        'pre-auto-gc',
        'post-checkout',
      ]) {
        await writeFile(join(hooks, name), `#!/bin/sh\n${command}\n`);
        await chmod(join(hooks, name), 0o755);
      }
      git('config', 'core.hooksPath', hooks);
    }
    if (vector === 'parent-env') vi.stubEnv('GIT_EXTERNAL_DIFF', command);
    if (vector === 'config-env') {
      vi.stubEnv('GIT_CONFIG_COUNT', '1');
      vi.stubEnv('GIT_CONFIG_KEY_0', 'core.fsmonitor');
      vi.stubEnv('GIT_CONFIG_VALUE_0', command);
      vi.stubEnv('GIT_DIR', '/nonexistent');
      vi.stubEnv('GIT_WORK_TREE', '/nonexistent');
      vi.stubEnv('GIT_INDEX_FILE', '/nonexistent');
    }
    const repo = createGit(root);
    await repo.status();
    await expect(access(marker)).rejects.toThrow();
    await repo.diff('file');
    await expect(access(marker)).rejects.toThrow();
    await repo.diff('untracked');
    await expect(access(marker)).rejects.toThrow();
    expect(await repo.fileAtHead('file')).toBe('before\n');
    await expect(access(marker)).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

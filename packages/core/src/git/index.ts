import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { parsePatch } from 'diff';
import { createFileAccess } from '../files/index.js';
import { deniedPath, inside, validateRelative } from '../files/policy.js';
import { redactText } from '../redact/index.js';

export interface GitStatusFile {
  path: string;
  index: string;
  worktree: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
}
export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
}
export function createGit(root: string) {
  const overrides = [
    'core.fsmonitor=false',
    'core.untrackedCache=false',
    'core.hooksPath=/dev/null',
    'core.pager=cat',
    'diff.external=',
    'core.sshCommand=false',
    'core.askPass=',
    'credential.helper=',
    'protocol.allow=never',
    'submodule.recurse=false',
    'core.splitIndex=false',
  ];
  async function run(args: string[], input?: string): Promise<string> {
    const filters: string[] = [];
    if (['status', 'diff', 'show'].includes(args[0]!)) {
      const names = await run([
        'config',
        '--null',
        '--name-only',
        '--get-regexp',
        '^filter\\.',
      ]);
      for (const key of names.split('\0').filter(Boolean)) {
        const driver = key.slice(7, key.lastIndexOf('.'));
        for (const setting of [
          'clean=',
          'smudge=',
          'process=',
          'required=false',
        ])
          filters.push(`filter.${driver}.${setting}`);
      }
    }
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ'])
      if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      GIT_EXTERNAL_DIFF: '',
      GIT_PAGER: 'cat',
      PAGER: 'cat',
    });
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        [
          '--no-optional-locks',
          ...[...overrides, ...filters].flatMap((value) => ['-c', value]),
          ...args,
        ],
        { cwd: root, timeout: 5000, maxBuffer: 20 * 1024 * 1024, env },
        (error, stdout, stderr) => {
          if (
            error &&
            !(
              error.code === 1 &&
              (args.includes('--no-index') ||
                args[0] === 'check-ignore' ||
                args[0] === 'config')
            )
          )
            reject(
              Object.assign(new Error('Git read failed', { cause: error }), {
                timedOut: error.killed,
                details: stderr,
              }),
            );
          else resolve(stdout);
        },
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
  async function isRepo(): Promise<boolean> {
    try {
      return (
        (await run(['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
      );
    } catch (error) {
      if (
        error instanceof Error &&
        'details' in error &&
        typeof error.details === 'string' &&
        error.details.includes('not a git repository')
      )
        return false;
      throw error;
    }
  }
  async function checkIgnore(paths: string[]): Promise<Set<string>> {
    if (!paths.length) return new Set();
    return new Set(
      (await run(['check-ignore', '-z', '--stdin'], paths.join('\0') + '\0'))
        .split('\0')
        .filter(Boolean),
    );
  }
  async function safe(path: string): Promise<boolean> {
    try {
      validateRelative(path);
      if (deniedPath(path)) return false;
      const base = await realpath(root);
      let target: string;
      try {
        target = await realpath(resolve(root, path));
      } catch {
        let ancestor = resolve(root, path);
        for (;;) {
          try {
            const info = await lstat(ancestor);
            if (info.isSymbolicLink()) return false;
            target = resolve(
              await realpath(ancestor),
              relative(ancestor, resolve(root, path)),
            );
            break;
          } catch (error) {
            if (
              (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
              dirname(ancestor) === ancestor
            )
              return false;
            ancestor = dirname(ancestor);
          }
        }
      }
      return inside(base, target) && !deniedPath(relative(base, target));
    } catch {
      return false;
    }
  }
  async function status(): Promise<GitStatus> {
    const prefix = (await run(['rev-parse', '--show-prefix'])).trimEnd();
    const raw = await run([
      'status',
      '--porcelain=v2',
      '-b',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=all',
      '--',
      '.',
    ]);
    const result: GitStatus = { branch: '', ahead: 0, behind: 0, files: [] };
    const parts = raw.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i]!;
      if (line.startsWith('# branch.head '))
        result.branch = redactText(line.slice(14));
      else if (line.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(line);
        result.ahead = Number(m?.[1] ?? 0);
        result.behind = Number(m?.[2] ?? 0);
      } else if (/^[12u?] /.test(line)) {
        const type = line[0];
        const xy = type === '?' ? '??' : line.slice(2, 4);
        const repoPath =
          type === '?'
            ? line.slice(2)
            : line
                .split(' ')
                .slice(type === '2' ? 9 : type === 'u' ? 10 : 8)
                .join(' ');
        const path = repoPath.startsWith(prefix)
          ? repoPath.slice(prefix.length)
          : '../';
        if (type === '2') {
          const original = parts[++i] ?? '';
          if (
            !original.startsWith(prefix) ||
            !(await safe(original.slice(prefix.length)))
          )
            continue;
        }
        if (!(await safe(path))) continue;
        result.files.push({
          path: redactText(path),
          index: xy[0]!,
          worktree: xy[1]!,
          status:
            type === '?'
              ? 'untracked'
              : xy.includes('R')
                ? 'renamed'
                : xy.includes('D')
                  ? 'deleted'
                  : xy.includes('A')
                    ? 'added'
                    : 'modified',
        });
      }
    }
    return result;
  }
  async function fileAtHead(path: string): Promise<string> {
    if (!(await safe(path))) throw new Error('Unsafe path');
    return redactText(
      await run(['show', '--no-ext-diff', '--no-textconv', `HEAD:./${path}`]),
    );
  }
  async function diff(path?: string): Promise<string> {
    if (path !== undefined && !(await safe(path)))
      throw new Error('Unsafe path');
    const state = await status();
    const chunks: string[] = [];
    for (const file of state.files) {
      if (path !== undefined && file.path !== path) continue;
      // Per-file reads enforce the same deny/symlink boundary as the browser.
      if (!(await safe(file.path))) continue;
      if (file.status === 'untracked') {
        const content = await createFileAccess({ root }).readFile(file.path);
        if (!content.binary && !content.tooLarge)
          chunks.push(
            await run([
              'diff',
              '--no-ext-diff',
              '--no-textconv',
              '--no-index',
              '--',
              '/dev/null',
              file.path,
            ]),
          );
      } else {
        // No external diff drivers or textconv commands, even if repo config requests them.
        try {
          chunks.push(
            await run([
              'diff',
              '--no-ext-diff',
              '--no-textconv',
              '--relative',
              'HEAD',
              '--',
              file.path,
            ]),
          );
        } catch {
          chunks.push(
            await run([
              'diff',
              '--no-ext-diff',
              '--no-textconv',
              '--relative',
              '--cached',
              '--',
              file.path,
            ]),
          );
        }
      }
    }
    return redactText(chunks.join('\n'));
  }
  return { isRepo, status, diff, fileAtHead, checkIgnore };
}
export function parseGitDiff(text: string) {
  return parsePatch(redactText(text)).map((patch) => ({
    oldPath: patch.oldFileName ?? '',
    path:
      patch.newFileName === '/dev/null'
        ? (patch.oldFileName ?? '').replace(/^a\//, '')
        : (patch.newFileName ?? '').replace(/^b\//, ''),
    hunks: patch.hunks,
  }));
}

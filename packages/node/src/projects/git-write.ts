import { execFile, type ExecFileOptions } from 'node:child_process';
import { dirname } from 'node:path';
import { redactText } from '@c9view/core';
import { ControlError } from '../control/errors.js';
import type { ParsedGitUrl } from './url.js';

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

export interface GitWriter {
  clone(
    url: ParsedGitUrl,
    directory: string,
    signal?: AbortSignal,
  ): Promise<void>;
  init(directory: string): Promise<void>;
}

const config = [
  'protocol.file.allow=never',
  'protocol.ext.allow=never',
  'core.hooksPath=/dev/null',
  'core.fsmonitor=false',
].flatMap((value) => ['-c', value]);
const inherited = [
  'PATH',
  'HOME',
  'LANG',
  'SSH_AUTH_SOCK',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
] as const;

/** Environment built from scratch: nothing else, and no other GIT_* variable, is passed. */
export function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of inherited)
    if (source[key] !== undefined) env[key] = source[key];
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https:ssh',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
  };
}

/** The last `fatal:` or `error:` line; git's first line is only "Cloning into ...". */
export function failureLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim());
  return (
    [...lines].reverse().find((line) => /^(fatal|error):/i.test(line)) ??
    [...lines].reverse().find(Boolean) ??
    ''
  );
}

// The timeout and the abort signal kill only the git process, not helper
// processes it spawned (ssh, credential helpers). Killing a process group needs
// a detached child, which execFile does not offer without losing the output
// limit; the helpers see their stdin closed and BatchMode makes ssh exit.
/** The only module that runs git commands that write. It shares nothing with the read-only git helper. */
export function createGitWriter(options: {
  timeoutMs: number;
  execFile?: ExecFileFn;
  env?: NodeJS.ProcessEnv;
}): GitWriter {
  const run = options.execFile ?? (execFile as unknown as ExecFileFn);
  const exec = (
    command: string,
    args: string[],
    directory: string,
    signal?: AbortSignal,
  ) =>
    new Promise<void>((resolve, reject) => {
      run(
        'git',
        [...config, command, ...args],
        {
          shell: false,
          timeout: options.timeoutMs,
          env: gitEnvironment(options.env ?? process.env),
          cwd: dirname(directory),
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          ...(signal ? { signal } : {}),
        },
        (error, _stdout, stderr) => {
          if (!error) return resolve();
          const detail = redactText(failureLine(stderr || error.message))
            .split(directory)
            .join('<folder>')
            .slice(0, 300);
          reject(
            new ControlError(
              503,
              `git ${command} failed${detail ? `: ${detail}` : ''}`,
            ),
          );
        },
      );
    });
  return {
    clone: (url, directory, signal) =>
      exec(
        'clone',
        ['--no-recurse-submodules', '--template=', '--', url, directory],
        directory,
        signal,
      ),
    init: (directory) =>
      exec('init', ['--template=', '--', directory], directory),
  };
}

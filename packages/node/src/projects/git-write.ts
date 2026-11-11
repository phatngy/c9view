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
          const detail = redactText(
            (stderr || error.message).split('\n').find((l) => l.trim()) ?? '',
          )
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

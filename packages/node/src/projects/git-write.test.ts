import { expect, it } from 'vitest';
import {
  createGitWriter,
  gitEnvironment,
  type ExecFileFn,
} from './git-write.js';
import { parseGitUrl } from './url.js';

function fake(error?: Error, stderr = '') {
  const calls: {
    file: string;
    args: readonly string[];
    options: Record<string, unknown>;
  }[] = [];
  const execFile: ExecFileFn = (file, args, options, callback) => {
    calls.push({ file, args, options: options as Record<string, unknown> });
    callback(error ?? null, '', stderr);
  };
  return { calls, execFile };
}
const source = {
  PATH: '/bin',
  HOME: '/home/x',
  LANG: 'C',
  SSH_AUTH_SOCK: '/run/agent',
  XDG_RUNTIME_DIR: '/run/user/1',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus',
  GIT_DIR: '/evil',
  GIT_SSH_COMMAND: 'evil',
  GIT_CONFIG_COUNT: '1',
  C9VIEW_TOKEN: 'secret',
  AWS_SECRET_ACCESS_KEY: 'secret',
};

it('T064 builds the environment from scratch', () => {
  expect(gitEnvironment(source)).toEqual({
    PATH: '/bin',
    HOME: '/home/x',
    LANG: 'C',
    SSH_AUTH_SOCK: '/run/agent',
    XDG_RUNTIME_DIR: '/run/user/1',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https:ssh',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
  });
});
it('T064 clone uses no shell, hardened config, a timeout and -- before URL and directory', async () => {
  const { calls, execFile } = fake();
  const git = createGitWriter({ timeoutMs: 600000, execFile, env: source });
  await git.clone(parseGitUrl('https://host.example/o/r.git'), '/work/p');
  const call = calls[0]!;
  expect(call.file).toBe('git');
  expect(call.options).toMatchObject({
    shell: false,
    timeout: 600000,
    cwd: '/work',
  });
  const args = call.args.join(' ');
  for (const value of [
    '-c protocol.file.allow=never',
    '-c protocol.ext.allow=never',
    '-c core.hooksPath=/dev/null',
    '--no-recurse-submodules',
    '--template=',
  ])
    expect(args).toContain(value);
  expect(args).not.toContain('core.sshCommand');
  expect(call.args.slice(-3)).toEqual([
    '--',
    'https://host.example/o/r.git',
    '/work/p',
  ]);
  expect(
    Object.keys(call.options.env as object)
      .filter((k) => k.startsWith('GIT_'))
      .sort(),
  ).toEqual([
    'GIT_ALLOW_PROTOCOL',
    'GIT_CONFIG_NOSYSTEM',
    'GIT_SSH_COMMAND',
    'GIT_TERMINAL_PROMPT',
  ]);
});
it('T064 init puts -- before the directory', async () => {
  const { calls, execFile } = fake();
  await createGitWriter({ timeoutMs: 1, execFile }).init('/work/p');
  expect(calls[0]!.args.slice(-3)).toEqual(['--template=', '--', '/work/p']);
});
it('T064 redacts git errors and hides the folder path', async () => {
  const { execFile } = fake(
    new Error('x'),
    'fatal: could not read /work/p token=ghp_abcdefghijklmnopqrstuvwxyz0123456789\nmore',
  );
  const error = await createGitWriter({ timeoutMs: 1, execFile })
    .clone(parseGitUrl('https://h.example/o/r'), '/work/p')
    .catch((e: Error) => e);
  expect((error as Error).message).toContain('git clone failed');
  expect((error as Error).message).not.toContain('/work/p');
  expect((error as Error).message).not.toContain(
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  );
  expect((error as Error).message).not.toContain('more');
});

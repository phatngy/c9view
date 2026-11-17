// Control-on e2e server: real hub, node, login (token auth) and index over a
// temporary copy of tests/fixtures/claude-control, with the Agent SDK replaced
// by control-fake-sdk.ts. C9VIEW_TOKEN (synthetic) comes from playwright.config.ts. No network, real Claude or real credentials.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'c9view-e2e-ctl-')));
const claudeDir = join(temporary, '.claude');
const folder = join(temporary, 'workspace', 'control-demo');
const projectDir = join(claudeDir, 'projects', '-synthetic-control');
mkdirSync(folder, { recursive: true });
// Synthetic workspace root for New project: one empty folder to open in it.
const workspaceRoot = join(temporary, 'e2e-workspace');
mkdirSync(join(workspaceRoot, 'fresh-app'), { recursive: true });
cpSync(resolve('tests/fixtures/claude-control'), claudeDir, {
  recursive: true,
});
for (const name of readdirSync(projectDir)) {
  const file = join(projectDir, name);
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replaceAll('__PROJECT_DIR__', folder),
  );
}
// The folder is already trusted, so the specs need no trust step.
writeFileSync(
  join(temporary, '.claude.json'),
  JSON.stringify({ projects: { [folder]: { hasTrustDialogAccepted: true } } }),
);
// Fake `claude` executable: c9view only runs `--version` on it.
const binary = join(temporary, 'claude.js');
writeFileSync(binary, "console.log('0.0.0-e2e');\n");

// A fake terminal session's socket folder: `<XDG_RUNTIME_DIR>/cc-socks`, one of
// the folders the node accepts. The node's gate is unchanged; its environment
// just names a runtime folder inside this temporary tree, owned by this user.
const runtimeDir = join(temporary, 'run');
mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

const server = spawn(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    resolve('tests/e2e/control-sdk-register.ts'),
    'packages/cli/dist/main.js',
    'start',
    '--control',
    '--port',
    '7793',
    '--host',
    '127.0.0.1',
    '--auth',
    'token',
    '--claude-dir',
    claudeDir,
    '--db',
    join(temporary, 'index.sqlite'),
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: runtimeDir,
      // Short enough for "not seen yet" to show within a spec.
      C9VIEW_REMOTE_NOT_SEEN_SEC: '3',
      C9VIEW_E2E_FAKE_SDK: '1',
      C9VIEW_E2E_FAKE_PROJECT_DIR: projectDir,
      C9VIEW_CLAUDE_BIN: binary,
      C9VIEW_CONTROL_MAX_RUNS: '10',
      C9VIEW_STATE_DIR: join(claudeDir, 'c9view'),
      C9VIEW_ALLOWED_HOSTS: '',
      C9VIEW_TRUST_PROXY: '',
      C9VIEW_INSECURE_NO_AUTH: '',
      C9VIEW_WORKSPACE_ROOTS: workspaceRoot,
      C9VIEW_E2E_FAKE_PROJECTS_DIR: join(claudeDir, 'projects'),
      C9VIEW_E2E_FAKE_WORKSPACE_ROOT: workspaceRoot,
      C9VIEW_CONTROL_BYPASS: '0',
      C9VIEW_WEB_DIST: resolve('apps/web/dist'),
    },
  },
);

// The node's output goes to this process's own and is also kept (bounded) for
// the leak search in remote.spec.ts, served at GET /server-output below.
let output = '';
for (const [stream, target] of [
  [server.stdout, process.stdout],
  [server.stderr, process.stderr],
] as const) {
  stream.on('data', (chunk: Buffer) => {
    target.write(chunk);
    output = (output + chunk.toString('utf8')).slice(-1_000_000);
  });
}

// Test-only controller for fake terminal sessions (loopback only). Each fake is
// its own child process, so its PID and start time are real. POST /terminals
// starts one and answers with its control port (see fake-terminal.ts).
const terminals = new Set<ChildProcess>();
function procStartOf(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)[19]!;
}
function startTerminal(options: {
  sessionId: string;
  live?: Record<string, unknown>;
  permissionMode?: string | null;
  unverified?: boolean;
}) {
  return new Promise<{ port: number; pid: number }>((done, fail) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', resolve('tests/e2e/fake-terminal.ts')],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: {
          ...process.env,
          C9VIEW_E2E_FAKE_TERMINAL: JSON.stringify({
            claudeDir,
            projectDir,
            folder,
            settingsDir: join(temporary, 'cwd', options.sessionId),
            runtimeDir,
            sessionId: options.sessionId,
            // The receiver's kernel check would name the node as the sender.
            verifiedPid: options.unverified ? 1 : server.pid,
            verifiedProcStart: options.unverified
              ? '1'
              : procStartOf(server.pid!),
            ...(options.live ? { live: options.live } : {}),
            ...(options.permissionMode !== undefined
              ? { permissionMode: options.permissionMode }
              : {}),
          }),
        },
      },
    );
    terminals.add(child);
    child.once('exit', () => terminals.delete(child));
    child.once('error', fail);
    let line = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      line += chunk.toString('utf8');
      if (!line.includes('\n')) return;
      try {
        done(JSON.parse(line.split('\n')[0]!));
      } catch (error) {
        fail(error);
      }
    });
    child.once('exit', () => fail(new Error('fake terminal exited')));
  });
}
// Only the Playwright runner and its workers know the token; a page in a
// browser can neither send it nor pass the Host and Origin checks.
const terminalToken = process.env.C9VIEW_E2E_TERMINAL_TOKEN ?? '';
const controller = createServer((request, response) => {
  const reply = (status: number, value: unknown) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  };
  if (
    !terminalToken ||
    request.headers.host !== '127.0.0.1:7794' ||
    request.headers.origin !== undefined ||
    request.headers['x-e2e-terminal-token'] !== terminalToken
  )
    return reply(403, { error: 'forbidden' });
  if (request.method === 'GET' && request.url === '/server-output')
    return reply(200, { output });
  if (request.method !== 'POST' || request.url !== '/terminals')
    return reply(404, { error: 'unknown' });
  let text = '';
  request.on('data', (chunk) => {
    text += chunk;
    if (text.length > 65_536) request.destroy();
  });
  request.on('end', () => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return reply(400, { error: 'bad json' });
    }
    const body = value as Record<string, unknown> | null;
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.sessionId !== 'string' ||
      !/^[a-z0-9-]{1,40}$/.test(body.sessionId) ||
      (body.live !== undefined &&
        (typeof body.live !== 'object' || body.live === null)) ||
      (body.permissionMode !== undefined &&
        body.permissionMode !== null &&
        typeof body.permissionMode !== 'string') ||
      (body.unverified !== undefined && typeof body.unverified !== 'boolean')
    )
      return reply(400, { error: 'bad request' });
    startTerminal(body as Parameters<typeof startTerminal>[0])
      .then((started) => reply(200, started))
      .catch(() => reply(500, { error: 'could not start' }));
  });
});
controller.listen(7794, '127.0.0.1');

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of terminals) child.kill('SIGKILL');
  controller.close();
  server.kill('SIGTERM');
  const force = setTimeout(() => server.kill('SIGKILL'), 3000);
  force.unref();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
server.once('error', () => {
  rmSync(temporary, { recursive: true, force: true });
  process.exitCode = 1;
});
server.once('exit', (code) => {
  rmSync(temporary, { recursive: true, force: true });
  process.exitCode = stopping ? 0 : (code ?? 1);
});

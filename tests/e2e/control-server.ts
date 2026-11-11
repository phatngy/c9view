// Control-on e2e server: real hub, node, login (token auth) and index over a
// temporary copy of tests/fixtures/claude-control, with the Agent SDK replaced
// by control-fake-sdk.ts. C9VIEW_TOKEN (synthetic) comes from playwright.config.ts. No network, real Claude or real credentials.
import { spawn } from 'node:child_process';
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
    stdio: 'inherit',
    env: {
      ...process.env,
      C9VIEW_E2E_FAKE_SDK: '1',
      C9VIEW_E2E_FAKE_PROJECT_DIR: projectDir,
      C9VIEW_CLAUDE_BIN: binary,
      C9VIEW_CONTROL_MAX_RUNS: '10',
      C9VIEW_STATE_DIR: join(claudeDir, 'c9view'),
      C9VIEW_ALLOWED_HOSTS: '',
      C9VIEW_TRUST_PROXY: '',
      C9VIEW_INSECURE_NO_AUTH: '',
      C9VIEW_WORKSPACE_ROOTS: '',
      C9VIEW_CONTROL_BYPASS: '0',
      C9VIEW_WEB_DIST: resolve('apps/web/dist'),
    },
  },
);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
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

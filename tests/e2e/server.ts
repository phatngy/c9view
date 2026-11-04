import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Keep the index and hook state out of both the fixture tree and the user's data.
const temporary = mkdtempSync(join(tmpdir(), 'c9view-e2e-'));
const server = spawn(
  process.execPath,
  [
    'packages/cli/dist/main.js',
    'start',
    '--port',
    '7791',
    '--host',
    '127.0.0.1',
    '--auth',
    'none',
    '--claude-dir',
    resolve('tests/fixtures/claude'),
    '--db',
    join(temporary, 'index.sqlite'),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      C9VIEW_STATE_DIR: join(temporary, 'state'),
      C9VIEW_ALLOWED_HOSTS: '',
      C9VIEW_TRUST_PROXY: '',
      C9VIEW_INSECURE_NO_AUTH: '',
      C9VIEW_WORKSPACE_ROOTS: '',
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

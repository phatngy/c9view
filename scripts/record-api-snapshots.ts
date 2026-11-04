// Records every /api/* response of the built `c9view start` on the synthetic
// fixture into tests/fixtures/api-snapshots/. Run after `corepack pnpm build`:
//   corepack pnpm snapshots:api
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ROUTES,
  SNAPSHOT_DIR,
  fetchSnapshot,
  prepareFixture,
  serialize,
  waitForReady,
} from './api-snapshots.ts';

const port = process.env.PORT ?? '7796';
const baseUrl = `http://127.0.0.1:${port}`;
const dirs = await prepareFixture();
const server = spawn(
  process.execPath,
  [
    'packages/cli/dist/main.js',
    'start',
    '--port',
    port,
    '--host',
    '127.0.0.1',
    '--auth',
    'none',
    '--claude-dir',
    dirs.claudeDir,
    '--db',
    dirs.db,
  ],
  {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      C9VIEW_STATE_DIR: dirs.stateDir,
      C9VIEW_ALLOWED_HOSTS: '',
      C9VIEW_TRUST_PROXY: '',
      C9VIEW_INSECURE_NO_AUTH: '',
      C9VIEW_WEB_DIST: resolve('apps/web/dist'),
    },
  },
);
try {
  await waitForReady(baseUrl);
  await rm(SNAPSHOT_DIR, { recursive: true, force: true });
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  for (const { name, path } of ROUTES)
    await writeFile(
      join(SNAPSHOT_DIR, `${name}.json`),
      serialize(await fetchSnapshot(baseUrl, path, dirs)),
    );
  console.log(`Recorded ${ROUTES.length} snapshots in ${SNAPSHOT_DIR}`);
} finally {
  server.kill('SIGTERM');
  await new Promise((done) => server.once('exit', done));
  await rm(dirs.root, { recursive: true, force: true });
}

import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  prepareFixture,
  ROUTES,
  fetchSnapshot,
  waitForReady,
  SNAPSHOT_DIR,
  serialize,
} from '../../../scripts/api-snapshots.ts';
import { startServer } from './main.js';

it('preserves every pre-split API snapshot through the real hub server', async () => {
  const dirs = await prepareFixture();
  const previousStateDir = process.env.C9VIEW_STATE_DIR;
  let server: ReturnType<typeof startServer> | undefined;
  try {
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    if (!address || typeof address === 'string')
      throw new Error('No free port');
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
    const webDist = join(dirs.root, 'web');
    await mkdir(webDist);
    await writeFile(join(webDist, 'index.html'), '<html>fixture SPA</html>');
    process.env.C9VIEW_STATE_DIR = dirs.stateDir;
    server = startServer({
      port: address.port,
      host: '127.0.0.1',
      auth: 'none',
      claudeDir: dirs.claudeDir,
      db: dirs.db,
      webDist,
    });
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await server.index.ready;
    await waitForReady(baseUrl);
    for (const { name, path } of ROUTES)
      expect(serialize(await fetchSnapshot(baseUrl, path, dirs)), path).toBe(
        await readFile(join(SNAPSHOT_DIR, `${name}.json`), 'utf8'),
      );
  } finally {
    if (server) {
      const closed = once(server, 'close');
      server.close();
      if ('closeAllConnections' in server) server.closeAllConnections();
      await closed;
      await server.index.close();
    }
    if (previousStateDir === undefined) delete process.env.C9VIEW_STATE_DIR;
    else process.env.C9VIEW_STATE_DIR = previousStateDir;
    await rm(dirs.root, { recursive: true, force: true });
  }
}, 60_000);

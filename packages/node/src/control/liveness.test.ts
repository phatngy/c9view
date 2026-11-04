import { afterEach, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLiveness } from './liveness.js';
import { setupControl } from './test-support.js';
import { pidNamespace } from '../data/status.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
it('T020 T023 refuses live PID or foreign namespace, accepts missing entries', async () => {
  const t = await setupControl();
  cleanup.push(t.close);
  const directory = join(t.claudeDir, 'sessions');
  await mkdir(directory);
  const check = createLiveness(t.claudeDir);
  await check('session');
  await writeFile(
    join(directory, 'synthetic.json'),
    JSON.stringify({
      sessionId: 'session',
      pid: process.pid,
      pidDomain: await pidNamespace(),
    }),
  );
  await expect(check('session')).rejects.toMatchObject({
    reason: 'live-elsewhere',
  });
  await writeFile(
    join(directory, 'synthetic.json'),
    JSON.stringify({
      sessionId: 'session',
      pid: process.pid,
      pidDomain: 'foreign',
    }),
  );
  await expect(check('session')).rejects.toMatchObject({
    reason: 'liveness-unknown',
  });
});

it('skips unrelated malformed entries but fails closed for target filename or partial content', async () => {
  const t = await setupControl();
  cleanup.push(t.close);
  const directory = join(t.claudeDir, 'sessions');
  await mkdir(directory);
  const check = createLiveness(t.claudeDir);
  await writeFile(join(directory, 'unrelated.json'), '{broken');
  await expect(check('session')).resolves.toBeUndefined();
  await writeFile(join(directory, 'unrelated.json'), '{"sessionId":"session",');
  await expect(check('session')).rejects.toMatchObject({
    reason: 'liveness-unknown',
  });
  await writeFile(join(directory, 'unrelated.json'), '{broken');
  await writeFile(join(directory, 'session.json'), '{broken');
  await expect(check('session')).rejects.toMatchObject({
    reason: 'liveness-unknown',
  });
});

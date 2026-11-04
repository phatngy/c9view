import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@c9view/core';
import { createNode } from './runtime.js';
import { HookEvents } from './data/hook-events.js';
import { InProcessTransport } from './transport.js';
import { DEFAULT_NODE_LIMITS } from './limits.js';
import { describeTransportContract } from './transport.contract.js';

describeTransportContract('InProcessTransport', async (handler, limits) => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-transport-'));
  const claudeDir = join(dir, 'claude');
  await cp(
    fileURLToPath(new URL('../test/fixtures/claude', import.meta.url)),
    claudeDir,
    { recursive: true },
  );
  const runtime = createNode(
    loadConfig({
      C9VIEW_CLAUDE_DIR: claudeDir,
      C9VIEW_DB: join(dir, 'index.db'),
    }),
    { hooks: new HookEvents(join(dir, 'hooks')) },
  );
  const transport = new InProcessTransport(
    runtime,
    { fetch: handler },
    { ...DEFAULT_NODE_LIMITS, ...limits },
  );
  return {
    transport,
    emit(event) {
      if (event.type === 'session')
        runtime.events.emit({
          event: 'session',
          data: {
            projectId: String(event.projectId),
            sessionId: String(event.sessionId),
          },
        });
      else runtime.events.emit({ event: 'config', data: {} });
    },
    async dispose() {
      transport.close();
      await runtime.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
});

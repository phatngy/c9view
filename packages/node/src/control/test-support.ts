import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DataStore } from '../data/store.js';
import { EventHub } from '../data/events.js';
import { FakeSdk } from './fake-sdk.js';
import { loadControlConfig, type ControlConfig } from './config.js';
import { createControlService } from './service.js';
export const tick = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 75));
export async function setupControl(
  overrides: Partial<ControlConfig> = {},
  options: {
    trusted?: boolean;
    liveness?: (id: string) => Promise<void>;
    roots?: boolean;
    git?: import('../projects/git-write.js').GitWriter;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'c9view-control-'));
  const claudeDir = join(root, '.claude');
  const folder = join(root, 'project');
  await mkdir(claudeDir, { mode: 0o700 });
  await mkdir(folder);
  if (options.trusted !== false)
    await writeFile(
      join(root, '.claude.json'),
      JSON.stringify({
        projects: { [folder]: { hasTrustDialogAccepted: true } },
      }),
    );
  const work = join(root, 'work');
  if (options.roots) await mkdir(work);
  const sdk = new FakeSdk();
  const bootId = randomUUID();
  const store = {
    config: {
      claudeDir,
      workspaceRoots: options.roots ? [work] : [],
      dbPath: join(root, 'index.db'),
    },
    events: new EventHub(),
    snapshot: async () => [{ project: { id: 'project', path: folder } }],
    findSession: async (project: string, session: string) =>
      project === 'project' && session === 'session'
        ? { session: { id: session } }
        : null,
  } as unknown as DataStore;
  const config = { ...loadControlConfig({}, { control: true }), ...overrides };
  const service = createControlService(store, config, bootId, {
    sdk: sdk.adapter,
    binary: '/fake/claude',
    stateDir: join(claudeDir, 'c9view'),
    env: {},
    ...(options.git ? { git: options.git } : {}),
    ...(options.liveness ? { liveness: options.liveness } : {}),
  });
  const body = () => ({
    clientRequestId: randomUUID(),
    text: 'synthetic prompt',
  });
  return {
    root,
    work,
    claudeDir,
    folder,
    store,
    sdk,
    bootId,
    service,
    config,
    body,
    close: async () => {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

// Test support only (excluded from the build): a control service wired to the
// fake terminal session, with its events captured.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { DataStore } from '../data/store.js';
import { EventHub, type NodeLiveEvent } from '../data/events.js';
import { FakeSdk } from '../control/fake-sdk.js';
import { loadControlConfig, type ControlConfig } from '../control/config.js';
import {
  createControlService,
  type ControlDependencies,
} from '../control/service.js';
import { controlRoutes } from '../control/routes.js';
import { createFakeSession, type FakeSessionOptions } from './fake-session.js';
import type { RemoteOptions } from './service.js';

export async function setupRemote(
  options: {
    fake?: FakeSessionOptions;
    config?: Partial<ControlConfig>;
    remote?: RemoteOptions;
    deps?: Partial<ControlDependencies>;
    bootId?: string;
  } = {},
) {
  const fake = await createFakeSession(options.fake);
  const events = new EventHub();
  const seen: NodeLiveEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const store = {
    config: {
      claudeDir: fake.claudeDir,
      workspaceRoots: [],
      dbPath: join(fake.root, 'index.db'),
    },
    events,
    snapshot: async () => [
      { project: { id: fake.projectId, path: fake.folder } },
    ],
    findSession: async (project: string, session: string) =>
      project === fake.projectId && session === fake.sessionId
        ? { session: { id: session } }
        : null,
  } as unknown as DataStore;
  const sdk = new FakeSdk();
  const bootId = options.bootId ?? randomUUID();
  const config = {
    ...loadControlConfig({}, { control: true }),
    ...options.config,
  };
  const make = (id = bootId) =>
    createControlService(store, config, id, {
      sdk: sdk.adapter,
      binary: '/fake/claude',
      stateDir: join(fake.claudeDir, 'c9view'),
      env: { ...fake.env, ANTHROPIC_API_KEY: 'test-key-not-real' },
      remote: { pollMs: 20, ...options.remote },
      ...options.deps,
    });
  const service = make();
  const body = (text = 'synthetic remote text') => ({
    clientRequestId: randomUUID(),
    text,
  });
  const app = controlRoutes(service);
  const post = (
    projectId: string,
    sessionId: string,
    value: unknown,
    boot = bootId,
  ) =>
    app.request(`/projects/${projectId}/sessions/${sessionId}/remote`, {
      method: 'POST',
      headers: { 'x-c9view-boot-id': boot, 'content-type': 'application/json' },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });
  return {
    fake,
    store,
    sdk,
    bootId,
    config,
    service,
    make,
    body,
    app,
    post,
    seen,
    close: async () => {
      await service.close();
      await fake.close();
      await rm(fake.root, { recursive: true, force: true });
    },
  };
}
export type RemoteHarness = Awaited<ReturnType<typeof setupRemote>>;

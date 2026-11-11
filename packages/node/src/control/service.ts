import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hookStateDir, mergeSettings, readSettings } from '@c9view/core';
import type {
  CommandReceipt,
  ControlCapability,
  ControlRuns,
  DecisionBody,
  ModeBody,
  NewProjectBody,
  NewSessionBody,
  SessionLabels,
  WorkspaceBrowse,
  LabelBody,
  ReplyBody,
  RunActionBody,
  TrustBody,
} from '@c9view/api';
import type { DataStore } from '../data/store.js';
import type { ControlConfig } from './config.js';
import {
  assertWritableDirectory,
  resolveClaudeBinary,
  claudeBinaryVersion,
} from './config.js';
import type { SdkAdapter } from './sdk.js';
import { childEnvironment } from './env.js';
import { Receipts } from './receipts.js';
import { Runs } from './runs.js';
import { Requests } from './requests.js';
import { createLiveness, type Liveness } from './liveness.js';
import { openControlState, type ControlState } from './state.js';
import { createLabels } from '../labels/labels.js';
import { createGitWriter, type GitWriter } from '../projects/git-write.js';
import { parseGitUrl } from '../projects/url.js';
import { openProject } from '../projects/create.js';
import { planClone, runClone } from '../projects/clone.js';
import { browse } from '../projects/browse.js';
import { realRoots } from '../projects/roots.js';
import { assertStateLocation, FolderTrust } from './trust.js';
import { ControlError } from './errors.js';
export interface ControlService {
  readonly claudeCodeVersion?: string;
  readonly capability: ControlCapability;
  reply(
    projectId: string,
    sessionId: string,
    body: ReplyBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  start(
    projectId: string,
    body: NewSessionBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  decide(
    requestId: string,
    body: DecisionBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  interrupt(
    runId: string,
    body: RunActionBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  stop(
    runId: string,
    body: RunActionBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  setMode(
    runId: string,
    body: ModeBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  trust(body: TrustBody, bootId?: string): Promise<CommandReceipt>;
  /** Roots the node accepts project locations under (real paths); empty when none. */
  workspaceRoots(): Promise<string[]>;
  browse(path: string | undefined, hidden: boolean): Promise<WorkspaceBrowse>;
  createProject(body: NewProjectBody, bootId?: string): Promise<CommandReceipt>;
  label(
    projectId: string,
    sessionId: string,
    body: LabelBody,
    bootId?: string,
  ): Promise<CommandReceipt>;
  labels(): SessionLabels;
  snapshot(): ControlRuns;
  receipt(id: string): CommandReceipt | undefined;
  close(): Promise<void>;
}
export interface ControlDependencies {
  sdk?: SdkAdapter;
  state?: ControlState;
  git?: GitWriter;
  liveness?: Liveness;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  binary?: string;
}
export function createControlService(
  store: DataStore,
  config: ControlConfig,
  bootId: string,
  dependencies: ControlDependencies = {},
): ControlService {
  const env = dependencies.env ?? process.env;
  const stateDir = dependencies.stateDir ?? hookStateDir(env, []);
  assertWritableDirectory(store.config.claudeDir, 'Claude data directory');
  for (const folder of store.config.workspaceRoots)
    assertWritableDirectory(folder, 'project directory');
  assertStateLocation(
    stateDir,
    store.config.claudeDir,
    store.config.workspaceRoots,
  );
  const binary = dependencies.binary ?? resolveClaudeBinary(config, env);
  const version = dependencies.binary
    ? undefined
    : claudeBinaryVersion(binary, childEnvironment(env, stateDir));
  const state = dependencies.state ?? openControlState(stateDir);
  const folders = new FolderTrust(store.config.claudeDir, state);
  const labels = createLabels(
    state,
    async (projectId, sessionId) =>
      !!(await store.findSession(projectId, sessionId)),
  );
  const git =
    dependencies.git ??
    createGitWriter({ timeoutMs: config.cloneTimeoutMin * 60000, env });
  // Folders this boot created or opened under the roots: the only unknown
  // folders the trust step accepts, since they have no transcript yet.
  const opened = new Set<string>();
  const cloning = new AbortController();
  const receipts = new Receipts(
    bootId,
    config.receiptMin * 60000,
    config.tombstoneMax,
  );
  const emit = (event: import('@c9view/api').ControlEvent) => {
    const { type, ...data } = event;
    store.events.emit({
      event: type,
      data,
    } as import('../data/events.js').NodeLiveEvent);
  };
  const requests = new Requests(
    config.approvalMin * 60000,
    emit,
    (id, waiting) => runs.waiting(id, waiting),
  );
  const runs = new Runs(
    config.maxRuns,
    config.idleMin * 60000,
    dependencies.sdk ??
      (async (input, options) =>
        (await import('./sdk.js')).sdkAdapter(input, options)),
    emit,
    (id) => requests.close(id),
  );
  const liveness =
    dependencies.liveness ?? createLiveness(store.config.claudeDir);
  let closed = false;
  // Replies to one session are accepted in call order: each reply's checks and
  // run join wait for the previous reply of that session to settle (pass or
  // fail). Other sessions are never serialised behind it. The chain is entered
  // in call order because receipts.run calls the action from a
  // Promise.resolve().then microtask, queued in call order.
  const replyTails = new Map<string, Promise<unknown>>();
  const inOrder = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = replyTails.get(key) ?? Promise.resolve();
    const result = previous.then(work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    replyTails.set(key, tail);
    void tail.then(() => {
      if (replyTails.get(key) === tail) replyTails.delete(key);
    });
    return result;
  };
  const reserve = (
    operation: string,
    body: { clientRequestId: string },
    boot: string | undefined,
    action: () => Promise<Partial<CommandReceipt>>,
    target: Record<string, string> = {},
  ) => {
    if (closed || !config.control)
      return Promise.reject(new ControlError(404, 'Control is off'));
    return receipts.run(
      operation,
      body.clientRequestId,
      { ...body, ...target },
      boot,
      async () => {
        try {
          return await action();
        } catch (error) {
          if (error instanceof ControlError) throw error;
          throw new ControlError(
            503,
            error instanceof Error ? error.message : 'Control operation failed',
          );
        }
      },
    );
  };
  async function project(id: string) {
    const found = (await store.snapshot()).find((p) => p.project.id === id);
    if (!found?.project.path) throw new ControlError(404, 'Project not found');
    return checkedFolder(found.project.path);
  }
  async function checkedFolder(path: string) {
    const folder = await realpath(path);
    assertWritableDirectory(folder, 'project directory');
    assertStateLocation(stateDir, store.config.claudeDir, [folder]);
    return folder;
  }
  async function begin(
    projectId: string,
    body: NewSessionBody | ReplyBody,
    operation: string,
    source?: string,
    knownFolder?: string,
  ) {
    const folder = knownFolder
      ? await checkedFolder(knownFolder)
      : await project(projectId);
    if (source && !(await store.findSession(projectId, source)))
      throw new ControlError(404, 'Session not found');
    await folders.check(folder);
    const fork = 'fork' in body && body.fork === true;
    if (source && !fork && !runs.bySession(projectId, source))
      await liveness(source);
    const settings = mergeSettings(
      await readSettings(store.config.claudeDir, folder),
    ).effective;
    const permissions = settings.permissions as
      Record<string, unknown> | undefined;
    const defaultMode = permissions?.defaultMode;
    const requested =
      !source &&
      'permissionMode' in body &&
      (body.permissionMode === 'default' ||
        body.permissionMode === 'plan' ||
        body.permissionMode === 'acceptEdits')
        ? body.permissionMode
        : undefined;
    const mode = config.bypass
      ? 'bypassPermissions'
      : (requested ??
        (defaultMode === 'acceptEdits' || defaultMode === 'plan'
          ? defaultMode
          : 'default'));
    const sessionId = source && !fork ? source : randomUUID();
    const concurrent =
      source && !('fork' in body && body.fork)
        ? runs.bySession(projectId, source)
        : undefined;
    if (concurrent) {
      runs.enqueue(concurrent, body.text, (patch) =>
        receipts.update(operation, body.clientRequestId, patch),
      );
      return {
        status: 'accepted' as const,
        runId: concurrent.summary.runId,
        sessionId: concurrent.summary.sessionId,
        projectId,
      };
    }
    const run = runs.create(projectId, sessionId, mode);
    runs.enqueue(run, body.text, (patch) =>
      receipts.update(operation, body.clientRequestId, patch),
    );
    // Launch after the receipt has been installed, never wait on SDK startup.
    runs.launch(
      run,
      async () => {
        await folders.check(folder);
        assertWritableDirectory(folder, 'project directory');
        if (source && !fork) await liveness(source);
        const childEnv = childEnvironment(env, stateDir);
        if (store.config.claudeDir !== join(env.HOME ?? homedir(), '.claude'))
          childEnv.CLAUDE_CONFIG_DIR = store.config.claudeDir;
        return {
          cwd: folder,
          ...(source ? { resume: source, forkSession: fork } : { sessionId }),
          permissionMode: mode,
          env: childEnv,
          pathToClaudeCodeExecutable: binary,
          ...(config.maxTurns !== undefined
            ? { maxTurns: config.maxTurns }
            : {}),
          ...(config.maxBudgetUsd !== undefined
            ? { maxBudgetUsd: config.maxBudgetUsd }
            : {}),
          ...(!source &&
          'name' in body &&
          typeof body.name === 'string' &&
          body.name
            ? { extraArgs: { name: body.name } }
            : {}),
          abortController: run.abort,
          canUseTool: requests.handler(
            run.summary.runId,
            () => run.summary.sessionId,
          ),
        };
      },
      () => {},
    );

    return {
      status: 'accepted' as const,
      runId: run.summary.runId,
      ...(fork ? {} : { sessionId }),
      projectId,
    };
  }
  return {
    ...(version ? { claudeCodeVersion: version } : {}),
    get capability(): ControlCapability {
      const reason = closed ? 'Control is closed' : receipts.unavailable;
      return {
        state: reason ? 'unavailable' : 'ready',
        bypass: config.bypass,
        ...(reason ? { reason } : {}),
      };
    },
    reply: (projectId, sessionId, body, boot) => {
      const operation = 'reply';
      return reserve(
        operation,
        body,
        boot,
        // receipts.run runs the action from a microtask queued in call order,
        // so the chain is entered in call order, before any async liveness or
        // trust check. Never put an await before reserve/receipts.run in
        // reply, or call order is lost. A repeated clientRequestId returns the
        // existing promise before the action runs and takes no place in the
        // chain.
        () =>
          inOrder(`${projectId}\0${sessionId}`, () =>
            begin(projectId, body, operation, sessionId),
          ),
        { projectId, sessionId },
      );
    },
    start: (projectId, body, boot) => {
      const operation = 'start';
      return reserve(
        operation,
        body,
        boot,
        () => begin(projectId, body, operation),
        { projectId },
      );
    },
    decide: (id, body, boot) =>
      reserve(
        'decide',
        body,
        boot,
        async () => {
          requests.decide(id, body);
          return {};
        },
        { requestId: id },
      ),
    interrupt: (id, body, boot) =>
      reserve(
        'interrupt',
        body,
        boot,
        async () => {
          const run = runs.get(id);
          await run.ready;
          runs.get(id);
          await runs.interrupt(run);
          return { runId: id };
        },
        { runId: id },
      ),
    stop: (id, body, boot) =>
      reserve(
        'stop',
        body,
        boot,
        async () => {
          runs.stop(runs.get(id));
          return { runId: id };
        },
        { runId: id },
      ),
    setMode: (id, body, boot) =>
      reserve(
        'mode',
        body,
        boot,
        async () => {
          if (config.bypass)
            throw new ControlError(409, 'Bypass is fixed by the node flag');
          const run = runs.get(id);
          await run.ready;
          runs.get(id);
          await run.runner?.setPermissionMode(body.mode);
          run.summary.mode = body.mode;
          runs.emitRun(run);
          return { runId: id };
        },
        { runId: id },
      ),
    trust: (body, boot) =>
      reserve('trust', body, boot, async () => {
        const known = [
          ...(await store.snapshot()).flatMap((p) =>
            p.project.path ? [p.project.path] : [],
          ),
          ...opened,
        ];
        await folders.accept(body.path, body.fingerprint, known);
        return {};
      }),
    workspaceRoots: async () => {
      if (closed || !config.control) throw new ControlError(404, 'Not found');
      return realRoots(store.config.workspaceRoots);
    },
    browse: async (path, hidden) => {
      if (closed || !config.control) throw new ControlError(404, 'Not found');
      return browse(store.config.workspaceRoots, path, hidden);
    },
    createProject: (body, boot) =>
      reserve('project', body, boot, async () => {
        if ((await realRoots(store.config.workspaceRoots)).length === 0)
          throw new ControlError(404, 'Not found');
        const url =
          body.gitUrl !== undefined ? parseGitUrl(body.gitUrl) : undefined;
        if (url) {
          const plan = await planClone(
            store.config.workspaceRoots,
            body.location,
          );
          const id = body.clientRequestId;
          // Run after the receipt is installed so its status can be patched.
          setImmediate(() => {
            runClone(plan, url, git, cloning.signal)
              .then(
                (path) => {
                  opened.add(path);
                  receipts.update('project', id, { status: 'ready' });
                },
                (error: unknown) =>
                  receipts.update('project', id, {
                    status: 'failed',
                    error:
                      error instanceof Error
                        ? error.message
                        : 'git clone failed',
                  }),
              )
              .finally(() =>
                emit({ type: 'control.project', clientRequestId: id }),
              );
          });
          return { status: 'cloning' as const, projectId: plan.projectId };
        }
        const found = await openProject(
          store.config.workspaceRoots,
          body.location,
          body.gitInit ?? true,
          git,
        );
        opened.add(found.path);
        return begin(found.projectId, body, 'project', undefined, found.path);
      }),
    label: (projectId, sessionId, body, boot) =>
      reserve(
        'label',
        body,
        boot,
        async () => {
          await labels.set(projectId, sessionId, body.label);
          return { projectId, sessionId };
        },
        { projectId, sessionId },
      ),
    labels: () => {
      if (closed || !config.control) throw new ControlError(404, 'Not found');
      return labels.all();
    },
    snapshot: () => ({ runs: runs.snapshot(), requests: requests.snapshot() }),
    receipt: (id) => receipts.get(id),
    close: async () => {
      if (closed) return;
      closed = true;
      cloning.abort();
      requests.close();
      await runs.close();
      state.close();
    },
  };
}

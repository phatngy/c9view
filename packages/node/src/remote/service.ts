import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CommandReceipt,
  ControlEvent,
  RemoteAvailability,
  RemoteDelivery,
  RemoteSendBody,
} from '@c9view/api';
import type { Socket } from 'node:net';
import type { Receipts } from '../control/receipts.js';
import { ControlError } from '../control/errors.js';
import { processAlive } from '../data/status.js';
import {
  createAvailability,
  type AvailabilityDeps,
  type CheckRemote,
} from './availability.js';
import { RemoteUnavailableError } from './errors.js';
import { buildFrame } from './frame.js';
import { readProcStart } from './proc.js';
import { mapSend, sendFrame } from './send.js';
import { Tracker, type Pending } from './tracker.js';

const OPERATION = 'remote';
/** Fixed receipt texts: no native error text, path or address ever enters one. */
const FAILED_TEXT = {
  'session-ended': 'The terminal session ended',
  unreachable: 'The session could not be reached',
} as const;

/**
 * Test seams only. Production leaves every one unset; they must never be set
 * from the environment, a settings file or any request, because they replace
 * the ownership checks (alive, procStart, namespace, uid) and the transport.
 */
export interface RemoteOptions extends Pick<
  AvailabilityDeps,
  'platform' | 'uid' | 'tmp' | 'lstat' | 'alive' | 'procStartOf' | 'namespace'
> {
  pollMs?: number;
  connect?: (path: string) => Socket;
}

export interface RemoteDeps {
  claudeDir: string;
  env: NodeJS.ProcessEnv;
  sendTimeoutSec: number;
  notSeenSec: number;
  receipts: Receipts;
  /** Control is on and the service is not closed. */
  enabled(): boolean;
  /** 002's reservation: receipts.run plus its error mapping. */
  reserve(
    operation: string,
    body: { clientRequestId: string },
    boot: string | undefined,
    action: () => Promise<Partial<CommandReceipt>>,
    target: Record<string, string>,
  ): Promise<CommandReceipt>;
  /** 002's per-session order, shared with replies. */
  inOrder<T>(key: string, work: () => Promise<T>): Promise<T>;
  sessionExists(projectId: string, sessionId: string): Promise<boolean>;
  ownRun(projectId: string, sessionId: string): boolean;
  emit(event: ControlEvent): void;
  subscribe(
    listener: (event: { event: string; data: unknown }) => void,
  ): () => void;
  options?: RemoteOptions;
}

export interface RemoteService {
  availability(
    projectId: string,
    sessionId: string,
  ): Promise<RemoteAvailability>;
  send(
    projectId: string,
    sessionId: string,
    body: RemoteSendBody,
    boot?: string,
  ): Promise<CommandReceipt>;
  close(): void;
}

export function createRemoteService(deps: RemoteDeps): RemoteService {
  const options = deps.options ?? {};
  const alive = options.alive ?? processAlive;
  const procStartOf =
    options.procStartOf ?? ((pid: number) => readProcStart(pid));
  const check: CheckRemote = createAvailability({
    claudeDir: deps.claudeDir,
    env: deps.env,
    sessionExists: deps.sessionExists,
    ownRun: deps.ownRun,
    capped: () => deps.receipts.unavailable !== undefined,
    ...(options.platform ? { platform: options.platform } : {}),
    ...(options.uid !== undefined ? { uid: options.uid } : {}),
    ...(options.tmp ? { tmp: options.tmp } : {}),
    ...(options.lstat ? { lstat: options.lstat } : {}),
    alive,
    procStartOf,
    ...(options.namespace ? { namespace: options.namespace } : {}),
  });
  const hint = (id: string, projectId: string, sessionId: string) =>
    // After the receipt is installed, so a refetch finds it.
    setImmediate(() =>
      deps.emit({
        type: 'control.remote',
        clientRequestId: id,
        projectId,
        sessionId,
      }),
    );
  const patch = (pending: Pending, delivery: Partial<RemoteDelivery>) => {
    const current = deps.receipts.get(pending.clientRequestId)?.delivery;
    deps.receipts.update(OPERATION, pending.clientRequestId, {
      delivery: { ...current, ...delivery } as RemoteDelivery,
    });
    hint(pending.clientRequestId, pending.projectId, pending.sessionId);
  };
  const tracker = new Tracker({
    has: (operation, id) => deps.receipts.has(operation, id),
    onDelivered: (pending, found) => {
      const { reason: _reason, ...current } =
        deps.receipts.get(pending.clientRequestId)?.delivery ??
        ({} as RemoteDelivery);
      void _reason;
      deps.receipts.update(OPERATION, pending.clientRequestId, {
        delivery: { ...current, state: 'delivered', ...found },
      });
      hint(pending.clientRequestId, pending.projectId, pending.sessionId);
    },
    onNotSeen: (pending) => {
      // Uncertain stays uncertain; only a plain "sent" turns into "not seen".
      if (
        deps.receipts.get(pending.clientRequestId)?.delivery?.state === 'sent'
      )
        patch(pending, { state: 'not-seen' });
    },
    subscribe: deps.subscribe,
    notSeenMs: deps.notSeenSec * 1000,
    ...(options.pollMs ? { pollMs: options.pollMs } : {}),
  });

  const notFound = () => new ControlError(404, 'Not found');

  async function deliver(
    projectId: string,
    sessionId: string,
    body: RemoteSendBody,
    frame: ReturnType<typeof buildFrame>,
  ): Promise<Partial<CommandReceipt>> {
    // The fresh check, right before connecting; a stale page authorises nothing.
    const checked = await check(projectId, sessionId);
    if (!checked.target) throw new RemoteUnavailableError(checked.availability);
    const { target } = checked;
    const file = join(
      deps.claudeDir,
      'projects',
      projectId,
      `${sessionId}.jsonl`,
    );
    let tracked: { file: string | undefined; offset: number } = {
      file,
      offset: 0,
    };
    try {
      tracked = { file, offset: (await stat(file)).size };
    } catch (error) {
      // A transcript that does not exist yet starts at 0; any other failure is unresolvable.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        tracked = { file: undefined, offset: 0 };
    }
    const sentAt = new Date().toISOString();
    const outcome = await sendFrame(target.socketPath, frame.line, {
      timeoutMs: deps.sendTimeoutSec * 1000,
      ...(options.connect ? { connect: options.connect } : {}),
    });
    const result = mapSend(
      outcome,
      () => !alive(target.pid) || procStartOf(target.pid) !== target.procStart,
    );
    hint(body.clientRequestId, projectId, sessionId);
    if (result.state === 'failed')
      return {
        status: 'failed',
        projectId,
        sessionId,
        error: FAILED_TEXT[result.reason],
        delivery: { state: 'failed', reason: result.reason },
      };
    tracker.track({
      msgId: frame.msgId,
      operation: OPERATION,
      clientRequestId: body.clientRequestId,
      projectId,
      sessionId,
      ...tracked,
    });
    return {
      projectId,
      sessionId,
      delivery: { state: result.state, sentAt },
    };
  }

  return {
    async availability(projectId, sessionId) {
      if (!deps.enabled()) throw notFound();
      return (await check(projectId, sessionId)).availability;
    },
    send(projectId, sessionId, body, boot) {
      if (!deps.enabled()) return Promise.reject(notFound());
      let frame: ReturnType<typeof buildFrame>;
      try {
        // 400 bad-text and 413 are decided before anything is reserved.
        frame = buildFrame(body.text);
      } catch (error) {
        return Promise.reject(error);
      }
      // Never put an await before reserve: the per-session chain is entered in call order.
      return deps.reserve(
        OPERATION,
        body,
        boot,
        () =>
          deps.inOrder(`${projectId}\0${sessionId}`, () =>
            deliver(projectId, sessionId, body, frame),
          ),
        { projectId, sessionId },
      );
    },
    close: () => tracker.close(),
  };
}

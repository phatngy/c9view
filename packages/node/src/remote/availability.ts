import { join } from 'node:path';
import type { RemoteAvailability, RemoteUnavailableReason } from '@c9view/api';
import { pidNamespace, processAlive } from '../data/status.js';
import { ControlError } from '../control/errors.js';
import { readLive } from './discovery.js';
import { inboundRule } from './inbound.js';
import { readReceiverMode } from './mode.js';
import { readProcStart } from './proc.js';
import { socketPathOwned, type SocketCheckDeps } from './socket-path.js';
import { REMOTE_MIN_VERSION, meetsMinimum } from './version.js';

/** What a send needs from a passing check. In memory for one send, then dropped. */
export interface Target {
  pid: number;
  procStart: string;
  socketPath: string;
}
export interface Checked {
  availability: RemoteAvailability;
  target?: Target;
}

export interface AvailabilityDeps {
  claudeDir: string;
  env: NodeJS.ProcessEnv;
  sessionExists(projectId: string, sessionId: string): Promise<boolean>;
  /** True for a session one of c9view's own runs holds. */
  ownRun(projectId: string, sessionId: string): boolean;
  /** True when receipts are at the tombstone cap. */
  capped(): boolean;
  platform?: NodeJS.Platform;
  uid?: number;
  tmp?: string;
  lstat?: SocketCheckDeps['lstat'];
  alive?(pid: number): boolean;
  procStartOf?(pid: number): string | null;
  namespace?(): Promise<string | undefined>;
  now?(): number;
}

const domainInode = (domain: string | number) =>
  String(domain).match(/(?:pid:\[)?(\d+)\]?$/)?.[1] ?? String(domain);

function sessionState(status: string | undefined) {
  return status === 'idle' || status === 'busy' || status === 'waiting'
    ? status
    : 'unknown';
}

/**
 * The ordered, fail-closed gate (R7). Everything is read fresh on each call
 * and nothing is kept: the socket path lives only in the returned `target`.
 * One deliberate order choice: the PID namespace is compared before the
 * liveness test, because a PID from another namespace says nothing here.
 */
export function createAvailability(deps: AvailabilityDeps) {
  const platform = deps.platform ?? process.platform;
  const alive = deps.alive ?? processAlive;
  const procStartOf = deps.procStartOf ?? ((pid) => readProcStart(pid));
  return async function check(
    projectId: string,
    sessionId: string,
  ): Promise<Checked> {
    const result = (
      reason: RemoteUnavailableReason | undefined,
      extra: Partial<RemoteAvailability> = {},
    ): Checked => ({
      availability: {
        sessionId,
        available: reason === undefined,
        ...(reason ? { reason } : {}),
        ...extra,
        checkedAt: new Date((deps.now ?? Date.now)()).toISOString(),
      },
    });
    if (deps.capped()) return result('control-unavailable');
    if (platform !== 'linux') return result('unsupported-platform');
    if (!(await deps.sessionExists(projectId, sessionId)))
      throw new ControlError(404, 'Session not found');
    if (deps.ownRun(projectId, sessionId)) return result('own-run');
    const lookup = await readLive(deps.claudeDir, sessionId, {
      alive,
      procStartOf,
      namespace: deps.namespace ?? pidNamespace,
    });
    if (lookup.kind === 'unknown') return result('liveness-unknown');
    if (lookup.kind === 'none') return result('not-live');
    const entry = lookup.entry;
    const pid = entry.pid;
    if (pid === undefined || entry.pidDomain === undefined)
      return result('liveness-unknown');
    const namespace = await (deps.namespace ?? pidNamespace)();
    if (!namespace || domainInode(entry.pidDomain) !== namespace)
      return result('liveness-unknown');
    if (!alive(pid)) return result('not-live');
    const started = procStartOf(pid);
    if (
      started === null ||
      entry.procStart === undefined ||
      entry.procStart !== started
    )
      return result('address-invalid');
    if (entry.kind !== 'interactive' || entry.entrypoint !== 'cli')
      return result('not-interactive');
    if (!meetsMinimum(entry.version))
      return result('too-old', { minVersion: REMOTE_MIN_VERSION });
    if (entry.peerProtocol !== 1) return result('unknown-protocol');
    if (entry.messagingSocketPath === undefined) return result('no-address');
    const owned = await socketPathOwned(entry.messagingSocketPath, pid, {
      env: deps.env,
      ...(deps.uid !== undefined ? { uid: deps.uid } : {}),
      ...(deps.tmp !== undefined ? { tmp: deps.tmp } : {}),
      ...(deps.lstat ? { lstat: deps.lstat } : {}),
    });
    if (!owned) return result('address-invalid');
    const mode = await readReceiverMode(
      join(deps.claudeDir, 'projects', projectId, `${sessionId}.jsonl`),
    );
    const inbound = await inboundRule({
      claudeDir: deps.claudeDir,
      cwd: entry.cwd,
      mode,
    });
    if (inbound === 'refuse') return result('inbound-refused');
    const ok = result(undefined, {
      ...(inbound === 'hold' || inbound === 'may-hold' ? { inbound } : {}),
      sessionState: sessionState(entry.status),
    });
    ok.target = {
      pid,
      procStart: started,
      socketPath: entry.messagingSocketPath,
    };
    return ok;
  };
}
export type CheckRemote = ReturnType<typeof createAvailability>;

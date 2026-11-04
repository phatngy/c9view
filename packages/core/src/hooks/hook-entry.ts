import { constants } from 'node:fs';
import { lstat, rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { whitelistHookInput } from './fields.js';
import { hookStateDir, ensureStateDir } from './state-dir.js';
export { hookStateDir } from './state-dir.js';
export function normalizeHookEvent(input: unknown, now = new Date()) {
  const data = whitelistHookInput(input);
  const notificationType =
    data.notification_type ??
    (data.hook_event_name === 'Notification'
      ? /permission/i.test(data.message ?? '')
        ? 'permission_prompt'
        : /idle|waiting for input/i.test(data.message ?? '')
          ? 'idle_prompt'
          : undefined
      : undefined);
  const event = {
    v: 1 as const,
    ts: now.toISOString(),
    event: data.hook_event_name,
    sessionId: data.session_id,
    cwd: data.cwd,
    ...(data.tool_name ? { toolName: data.tool_name } : {}),
    ...(notificationType ? { notificationType } : {}),
    ...(data.permission_mode ? { permissionMode: data.permission_mode } : {}),
    ...(data.agent_id ? { agentId: data.agent_id } : {}),
    // https://code.claude.com/docs/en/hooks#common-input-fields: agent metadata
    // also describes session agents; only lifecycle events prove subagent scope.
    ...(['SubagentStart', 'SubagentStop'].includes(data.hook_event_name)
      ? { subagent: true }
      : {}),
    pid: process.ppid,
  };
  return event;
}
export async function appendHookEvent(
  input: unknown,
  stateDir?: string,
): Promise<void> {
  try {
    stateDir ??= hookStateDir();
    const line = JSON.stringify(normalizeHookEvent(input)) + '\n';
    if (Buffer.byteLength(line) >= 4096) return;
    await ensureStateDir(stateDir);
    const path = join(stateDir, 'events.jsonl');
    const rotated = join(stateDir, 'events.1.jsonl');
    const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (
      existing &&
      (!existing.isFile() ||
        existing.isSymbolicLink() ||
        (process.getuid && existing.uid !== process.getuid()))
    )
      return;
    if (existing && existing.size > 20 * 1024 * 1024) {
      const previous = await lstat(rotated).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return undefined;
        },
      );
      if (previous && (!previous.isFile() || previous.isSymbolicLink())) return;
      // Two hooks rotating concurrently can drop one rotation's worth of data;
      // this is acceptable for best-effort status telemetry (no ordering guarantee).
      const source = await open(
        path,
        constants.O_WRONLY | constants.O_NOFOLLOW,
      );
      try {
        await source.chmod(0o600);
      } finally {
        await source.close();
      }
      await rename(path, rotated);
    }
    const file = await open(
      path,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || (process.getuid && info.uid !== process.getuid()))
        return;
      await file.chmod(0o600);
      await file.writeFile(line);
    } finally {
      await file.close();
    }
  } catch {
    /* Best-effort hooks stay silent, including unsafe paths. */
  }
}
/** Bounded stdin collection; never retains a partial oversized payload. */
export function readHookInput(
  input: NodeJS.ReadStream = process.stdin,
): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      input.off('data', data);
      input.off('end', end);
      input.off('error', error);
      input.pause();
      resolve(value);
    };
    const data = (chunk: Buffer | string) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 65536) finish(null);
      else chunks.push(buffer);
    };
    const end = () => finish(Buffer.concat(chunks).toString('utf8'));
    const error = () => finish(null);
    const timer = setTimeout(() => finish(null), 1000);
    input.on('data', data);
    input.on('end', end);
    input.on('error', error);
  });
}

export async function runHook(): Promise<void> {
  try {
    const input = await readHookInput();
    if (input !== null) await appendHookEvent(JSON.parse(input));
  } catch {
    /* Invalid input must never affect Claude. */
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runHook();
  process.exit(0);
}

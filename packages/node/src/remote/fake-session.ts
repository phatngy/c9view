// Test support only (excluded from the build, never exported). A fake live
// terminal session for the current process: a temporary Claude folder, a
// sessions/<pid>.json with this process's real PID and procStart, a 0600
// socket in an owner-only XDG-style folder, a synthetic `.key` file and a
// fixture transcript. It never runs Claude and never touches a real folder.
import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readProcStart } from './proc.js';

/** Synthetic secrets that must never surface in any output. */
export const FAKE_PEER_TOKEN = 'sentinel-peer-token-7f3a9c0b51d24e68';
export const FAKE_KEY_CONTENT = 'sentinel-key-file-content-1b8e4d27a6c0';

export type FakeMode = 'accept' | 'reset' | 'close-mid';

export interface FakeSessionOptions {
  sessionId?: string;
  projectId?: string;
  /** Receiver permission-mode record in the transcript; null writes none. */
  permissionMode?: string | null;
  /** Fields merged into (or, when undefined, removed from) the live JSON. */
  live?: Record<string, unknown>;
  /** Append a peer record on every received frame. */
  autoDeliver?: 'user' | 'queued';
}

export interface ReceivedFrame {
  raw: string;
  json: Record<string, unknown>;
  msgId: string;
  /** Text between the wrapper tags, as the receiver stores `origin.body`. */
  body: string;
}

export async function createFakeSession(options: FakeSessionOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'c9fs-'));
  const claudeDir = join(root, '.claude');
  const folder = join(root, 'project');
  const runtimeDir = join(root, 'run');
  const socksDir = join(runtimeDir, 'cc-socks');
  const projectId = options.projectId ?? 'project';
  const sessionId = options.sessionId ?? randomUUID();
  const pid = process.pid;
  const procStart = readProcStart('self') ?? '0';
  const socketPath = join(socksDir, `${pid}.sock`);
  const transcriptDir = join(claudeDir, 'projects', projectId);
  const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`);
  const livePath = join(claudeDir, 'sessions', `${pid}.json`);
  await mkdir(join(claudeDir, 'sessions'), { recursive: true, mode: 0o700 });
  await mkdir(transcriptDir, { recursive: true });
  await mkdir(folder, { recursive: true });
  await mkdir(socksDir, { recursive: true, mode: 0o700 });
  for (const dir of [root, runtimeDir, socksDir]) await chmod(dir, 0o700);
  const ino = (await stat('/proc/self/ns/pid').catch(() => ({ ino: 0 }))).ino;

  const frames: ReceivedFrame[] = [];
  const sockets = new Set<Socket>();
  let mode: FakeMode = 'accept';
  let autoDeliver = options.autoDeliver;
  let server: Server | undefined;

  const liveBase = (): Record<string, unknown> => ({
    pid,
    sessionId,
    cwd: folder,
    startedAt: Date.now(),
    procStart,
    version: '2.1.325',
    peerProtocol: 1,
    peerFeatures: ['notify_idle'],
    kind: 'interactive',
    entrypoint: 'cli',
    messagingSocketPath: socketPath,
    name: 'synthetic',
    status: 'idle',
    pidDomain: `linux:fakehash:pid:[${ino}]`,
    peerToken: FAKE_PEER_TOKEN,
    ...options.live,
  });
  async function writeLive(patch: Record<string, unknown> = {}) {
    const value: Record<string, unknown> = { ...liveBase(), ...patch };
    for (const key of Object.keys(value))
      if (value[key] === undefined) delete value[key];
    await writeFile(livePath, JSON.stringify(value), { mode: 0o600 });
  }

  function parse(raw: string): ReceivedFrame | undefined {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const content = String(
        (json.message as { content?: unknown })?.content ?? '',
      );
      const body =
        /^<cross-session-message[^>]*>\n([\s\S]*)\n<\/cross-session-message>$/.exec(
          content,
        )?.[1] ?? content;
      return { raw, json, msgId: String(json.msg_id ?? ''), body };
    } catch {
      return undefined;
    }
  }
  function appendDelivered(frame: ReceivedFrame, kind: 'user' | 'queued') {
    return appendPeerRecord(kind, frame.msgId, { body: frame.body });
  }

  async function listen() {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (mode === 'reset') return void socket.resetAndDestroy();
        if (mode === 'close-mid') return void socket.destroy();
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const frame = parse(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          if (!frame) continue;
          frames.push(frame);
          if (autoDeliver) void appendDelivered(frame, autoDeliver);
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
  }

  async function appendRaw(line: unknown) {
    await appendFile(
      transcriptPath,
      (typeof line === 'string' ? line : JSON.stringify(line)) + '\n',
    );
  }
  async function appendPeerRecord(
    kind: 'user' | 'queued',
    msgId: string,
    extra: {
      body?: string;
      timestamp?: string;
      from?: string;
      name?: string;
    } = {},
  ) {
    const origin = {
      kind: 'peer',
      from: extra.from ?? 'uds:/dev/null/c9view',
      name: extra.name ?? 'c9view',
      msg_id: msgId,
      verifiedPeerPid: pid,
      verifiedPeerProcStart: procStart,
      body: extra.body ?? 'synthetic',
    };
    const timestamp = extra.timestamp ?? new Date().toISOString();
    await appendRaw(
      kind === 'user'
        ? {
            type: 'user',
            isMeta: true,
            uuid: randomUUID(),
            sessionId,
            timestamp,
            message: { role: 'user', content: 'synthetic receiver wrapper' },
            origin,
          }
        : {
            type: 'attachment',
            isMeta: true,
            uuid: randomUUID(),
            sessionId,
            timestamp,
            attachment: { type: 'queued_command', prompt: 'synthetic', origin },
          },
    );
  }

  await writeFile(
    join(claudeDir, 'sessions', `${pid}.deadbeef.key`),
    FAKE_KEY_CONTENT,
    { mode: 0o600 },
  );
  await writeFile(
    transcriptPath,
    options.permissionMode === null
      ? ''
      : JSON.stringify({
          type: 'permission-mode',
          permissionMode: options.permissionMode ?? 'default',
          sessionId,
        }) + '\n',
  );
  await writeLive();
  await listen();

  return {
    root,
    claudeDir,
    folder,
    runtimeDir,
    socketPath,
    transcriptPath,
    livePath,
    projectId,
    sessionId,
    pid,
    procStart,
    env: { XDG_RUNTIME_DIR: runtimeDir } as NodeJS.ProcessEnv,
    frames,
    setMode: (next: FakeMode) => void (mode = next),
    setAutoDeliver: (next: 'user' | 'queued' | undefined) =>
      void (autoDeliver = next),
    writeLive,
    removeLive: () => rm(livePath, { force: true }),
    appendRaw,
    appendPeerRecord,
    /** The terminal's own typed prompt, which never carries a peer origin. */
    appendHuman: (text: string) =>
      appendRaw({
        type: 'user',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        origin: { kind: 'human' },
        message: { role: 'user', content: text },
      }),
    writeUserSettings: (value: unknown) =>
      writeFile(join(claudeDir, 'settings.json'), JSON.stringify(value)),
    writeProjectSettings: async (value: unknown, local = false) => {
      await mkdir(join(folder, '.claude'), { recursive: true });
      await writeFile(
        join(
          folder,
          '.claude',
          local ? 'settings.local.json' : 'settings.json',
        ),
        JSON.stringify(value),
      );
    },
    /** Stop listening but keep the socket file: a killed session's stale socket (ECONNREFUSED). */
    stopListening: async () => {
      const keep = `${socketPath}.keep`;
      await link(socketPath, keep);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      await rename(keep, socketPath);
    },
    removeSocket: () => rm(socketPath, { force: true }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server ? server.close(() => resolve()) : resolve(),
      );
      await rm(root, { recursive: true, force: true });
    },
  };
}
export type FakeSession = Awaited<ReturnType<typeof createFakeSession>>;

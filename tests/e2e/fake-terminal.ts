// A fake live Claude Code terminal session for the remote-send e2e. It runs as
// its own process (spawned by control-server.ts), so its PID and start time are
// real: it writes sessions/<pid>.json with this process's own PID and procStart
// into the e2e temp Claude dir, listens on a 0600 socket in an owner-only
// `<XDG_RUNTIME_DIR>/cc-socks` folder, and appends the transcript records a real
// receiver writes. The node's ownership checks run unchanged against it; only
// the sender-side facts are simulated (see `verifiedPid` below).
//
// Scenario controls are a tiny HTTP server on 127.0.0.1 (ephemeral port, printed
// as the first stdout line) so a spec can make it hold, drop or reset a frame,
// type a prompt, or exit like a killed terminal. It never runs Claude.
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdirSync,
  renameSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface Config {
  claudeDir: string;
  /** Directory of the session transcript (projects/<id>). */
  projectDir: string;
  folder: string;
  /** The session's working folder for settings lookup (`<dir>/.claude/settings.json`). */
  settingsDir: string;
  runtimeDir: string;
  sessionId: string;
  /** What the receiver's kernel check would report for the sender: the node. */
  verifiedPid: number;
  verifiedProcStart: string;
  live?: Record<string, unknown>;
  /** Receiver permission-mode record; null writes none. */
  permissionMode?: string | null;
}
type Behavior = 'user' | 'queued' | 'hold' | 'drop';

const config = JSON.parse(
  process.env.C9VIEW_E2E_FAKE_TERMINAL ?? '{}',
) as Config;
if (!config.sessionId) throw new Error('fake-terminal needs its configuration');

// /proc/<pid>/stat field 22, parsed after the last ")" like the node does.
function procStartOf(pid: number | 'self'): string {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)[19]!;
}

const pid = process.pid;
const procStart = procStartOf('self');
const socksDir = join(config.runtimeDir, 'cc-socks');
const socketPath = join(socksDir, `${pid}.sock`);
const transcriptPath = join(config.projectDir, `${config.sessionId}.jsonl`);
const livePath = join(config.claudeDir, 'sessions', `${pid}.json`);
// Synthetic secrets: they must never reach any output the specs search.
const PEER_TOKEN = 'e2e-sentinel-peer-token-5c1d9b7a3e';
const KEY_CONTENT = 'e2e-sentinel-key-file-content-8f2a6d04';

mkdirSync(join(config.claudeDir, 'sessions'), { recursive: true });
mkdirSync(config.projectDir, { recursive: true });
mkdirSync(join(config.settingsDir, '.claude'), { recursive: true });
mkdirSync(socksDir, { recursive: true, mode: 0o700 });
chmodSync(config.runtimeDir, 0o700);
chmodSync(socksDir, 0o700);

let behavior: Behavior = 'user';
let reply = true;
const frames: { msgId: string; body: string; raw: string }[] = [];
const held: { msgId: string; body: string }[] = [];
const sockets = new Set<Socket>();

function appendLine(value: unknown) {
  appendFileSync(transcriptPath, `${JSON.stringify(value)}\n`);
}
function now() {
  return new Date().toISOString();
}
function writeLive(patch: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = {
    pid,
    sessionId: config.sessionId,
    cwd: config.settingsDir,
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
    // Same PID namespace as the node: the inode of /proc/self/ns/pid.
    pidDomain: `linux:e2e:pid:[${readNamespace()}]`,
    peerToken: PEER_TOKEN,
    ...config.live,
    ...patch,
  };
  for (const key of Object.keys(value))
    // null in a patch removes the field.
    if (value[key] === undefined || value[key] === null) delete value[key];
  writeFileSync(livePath, JSON.stringify(value), { mode: 0o600 });
}
function readNamespace() {
  const link = readlinkSync('/proc/self/ns/pid');
  return /\[(\d+)\]/.exec(link)![1]!;
}
function origin(msgId: string, body: string) {
  return {
    kind: 'peer',
    from: 'uds:/dev/null/c9view',
    name: 'c9view',
    msg_id: msgId,
    verifiedPeerPid: config.verifiedPid,
    verifiedPeerProcStart: config.verifiedProcStart,
    body,
  };
}
/** The receiver records the message (idle: a new turn; busy: queued for its next step). */
function record(kind: 'user' | 'queued', msgId: string, body: string) {
  const timestamp = now();
  if (kind === 'user')
    appendLine({
      type: 'user',
      isMeta: true,
      uuid: randomUUID(),
      sessionId: config.sessionId,
      timestamp,
      message: { role: 'user', content: 'synthetic receiver wrapper' },
      origin: origin(msgId, body),
    });
  else
    appendLine({
      type: 'attachment',
      isMeta: true,
      uuid: randomUUID(),
      sessionId: config.sessionId,
      timestamp,
      attachment: {
        type: 'queued_command',
        prompt: 'synthetic',
        origin: origin(msgId, body),
      },
    });
  if (reply) {
    const text = body.split('\n\n').slice(1).join('\n\n') || body;
    setTimeout(() => assistant(`Synthetic terminal reply to: ${text}`), 300);
  }
}
function assistant(text: string) {
  appendLine({
    type: 'assistant',
    uuid: randomUUID(),
    sessionId: config.sessionId,
    timestamp: now(),
    message: {
      role: 'assistant',
      id: randomUUID(),
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });
}

function handleFrame(line: string) {
  let json: { msg_id?: unknown; message?: { content?: unknown } };
  try {
    json = JSON.parse(line);
  } catch {
    return;
  }
  const content = String(json.message?.content ?? '');
  const body =
    /^<cross-session-message[^>]*>\n([\s\S]*)\n<\/cross-session-message>$/.exec(
      content,
    )?.[1] ?? content;
  const msgId = String(json.msg_id ?? '');
  frames.push({ msgId, body, raw: line });
  if (behavior === 'user' || behavior === 'queued')
    record(behavior, msgId, body);
  else if (behavior === 'hold') held.push({ msgId, body });
}

const listener = createServer((socket) => {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      handleFrame(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
});

// A real transcript: the permission mode, then one prompt and one answer.
writeFileSync(
  transcriptPath,
  (config.permissionMode === null
    ? ''
    : JSON.stringify({
        type: 'permission-mode',
        permissionMode: config.permissionMode ?? 'default',
        sessionId: config.sessionId,
      }) + '\n') +
    JSON.stringify({
      type: 'user',
      uuid: randomUUID(),
      timestamp: '2026-11-17T09:00:00Z',
      cwd: config.folder,
      version: '2.1.325',
      message: { role: 'user', content: 'Terminal session fixture' },
    }) +
    '\n' +
    JSON.stringify({
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: '2026-11-17T09:00:05Z',
      message: {
        role: 'assistant',
        id: randomUUID(),
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Waiting in the terminal' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) +
    '\n',
);
writeFileSync(
  join(config.claudeDir, 'sessions', `${pid}.deadbeef.key`),
  KEY_CONTENT,
  {
    mode: 0o600,
  },
);
writeLive();
await new Promise<void>((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(socketPath, resolve);
});
chmodSync(socketPath, 0o600);

function readBody(request: import('node:http').IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}') as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}
const control = createHttpServer(async (request, response) => {
  const path = request.url ?? '/';
  const body = request.method === 'POST' ? await readBody(request) : {};
  const send = (value: unknown) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(value));
  };
  if (path === '/state')
    return send({
      pid,
      frames: frames.map(({ msgId, body }) => ({ msgId, body })),
      held: held.length,
    });
  if (path === '/behavior') {
    behavior = body.behavior as Behavior;
    if (typeof body.reply === 'boolean') reply = body.reply;
    return send({ ok: true });
  }
  if (path === '/live') {
    writeLive((body.patch ?? {}) as Record<string, unknown>);
    return send({ ok: true });
  }
  // A held message the owner lets in at the terminal keeps its msg_id.
  if (path === '/release') {
    for (const item of held.splice(0))
      record(body.kind === 'queued' ? 'queued' : 'user', item.msgId, item.body);
    return send({ ok: true });
  }
  // A prompt typed in the terminal: no peer origin.
  if (path === '/human') {
    appendLine({
      type: 'user',
      uuid: randomUUID(),
      timestamp: now(),
      origin: { kind: 'human' },
      message: { role: 'user', content: String(body.text ?? '') },
    });
    return send({ ok: true });
  }
  // The session's own project settings (`crossSessionInbound` and the like).
  if (path === '/settings') {
    writeFileSync(
      join(config.settingsDir, '.claude', 'settings.json'),
      JSON.stringify(body.value ?? {}),
    );
    return send({ ok: true });
  }
  if (path === '/chmod') {
    chmodSync(socketPath, Number(body.mode));
    return send({ ok: true });
  }
  // A killed session: the listener is gone, the socket file and status file stay.
  if (path === '/stop-listening') {
    const keep = `${socketPath}.keep`;
    linkSync(socketPath, keep);
    for (const socket of sockets) socket.destroy();
    listener.close(() => {
      renameSync(keep, socketPath);
      send({ ok: true });
    });
    return;
  }
  // Exit like a killed terminal: the status file and socket stay behind.
  if (path === '/exit') {
    send({ ok: true });
    return void setTimeout(() => process.exit(0), 20);
  }
  response.statusCode = 404;
  send({ error: 'unknown' });
});
await new Promise<void>((resolve) => control.listen(0, '127.0.0.1', resolve));
const address = control.address();
process.stdout.write(
  `${JSON.stringify({ port: typeof address === 'object' && address ? address.port : 0, pid })}\n`,
);

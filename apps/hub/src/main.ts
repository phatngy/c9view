import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig } from '@c9view/core';
import { createApp } from './app.js';
import { createNode, loadNodeLimits } from '@c9view/node';
import { createLocalTransport } from './local-node.js';
import {
  authMode,
  normalizeBindHost,
  createAuth,
  validateExposure,
  type AuthMode,
} from './auth/index.js';

export interface StartServerOptions {
  control?: boolean;
  bypass?: boolean;
  port?: number;
  host?: string;
  claudeDir?: string;
  db?: string;
  allowedHosts?: string[];
  auth?: AuthMode;
  webDist?: string;
  onListening?: (url: string) => void;
}
export function startServer(options: StartServerOptions = {}) {
  const rawPort = options.port ?? process.env.PORT ?? '7777';
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(String(rawPort)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('PORT must be an integer from 1 to 65535');
  const hostname = normalizeBindHost(
    options.host ?? process.env.HOST ?? '127.0.0.1',
  );
  const allowedHosts = [
    ...(process.env.C9VIEW_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
    ...(options.allowedHosts ?? []),
  ];
  const mode = authMode(options.auth ?? process.env.C9VIEW_AUTH);
  if (
    mode === 'none' &&
    (options.control ?? process.env.C9VIEW_CONTROL === '1')
  )
    throw new Error(
      'Session control requires login on every host, including loopback. Set C9VIEW_AUTH=token or --auth password; C9VIEW_INSECURE_NO_AUTH cannot override this.',
    );
  validateExposure(
    hostname,
    allowedHosts,
    mode,
    process.env.C9VIEW_INSECURE_NO_AUTH === '1',
  );
  requireRecoverableToken(
    mode,
    process.env.C9VIEW_TOKEN !== undefined,
    process.stdout.isTTY === true,
  );
  const auth = createAuth({
    mode,
    ...(process.env.C9VIEW_TOKEN !== undefined
      ? { token: process.env.C9VIEW_TOKEN }
      : {}),
    ...(process.env.C9VIEW_PASSWORD
      ? { password: process.env.C9VIEW_PASSWORD }
      : {}),
    trustProxy: process.env.C9VIEW_TRUST_PROXY === '1',
  });
  const webDist = resolve(
    options.webDist ??
      process.env.C9VIEW_WEB_DIST ??
      fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  );
  if (!existsSync(resolve(webDist, 'index.html')))
    throw new Error(
      `Web build missing at ${webDist}. Run corepack pnpm build before c9view start (or set C9VIEW_WEB_DIST).`,
    );
  const config = loadConfig({
    ...process.env,
    ...(options.claudeDir ? { C9VIEW_CLAUDE_DIR: options.claudeDir } : {}),
    ...(options.db ? { C9VIEW_DB: options.db } : {}),
  });
  // Validate limits before the index watcher starts, so a bad value leaks nothing.
  const limits = loadNodeLimits();
  const nodeOptions: Parameters<typeof createNode>[1] = {
    ...(options.control !== undefined ? { control: options.control } : {}),
    ...(options.bypass !== undefined ? { bypass: options.bypass } : {}),
  };
  const runtime = createNode(config, nodeOptions);
  if (mode === 'none' && runtime.hello.capabilities.control.state !== 'off') {
    void runtime.close();
    throw new Error(
      'A node reporting control requires login. Set C9VIEW_AUTH=token or --auth password; C9VIEW_INSECURE_NO_AUTH cannot override this.',
    );
  }
  if (runtime.hello.capabilities.bypass)
    console.warn(
      'WARNING: Session control bypass is on. Every c9view run skips tool permission approvals and cannot leave bypass mode.',
    );
  const indexHandle = runtime.start();
  const transport = createLocalTransport(runtime, limits);
  const index = {
    ready: indexHandle.ready,
    close: () => {
      transport.close();
      return runtime.close();
    },
  };
  const app = createApp(config, {
    transport,
    limits,
    webDist,
    auth: auth.middleware,
    authMode: mode,
    allowedHosts: [hostname, ...allowedHosts],
  });
  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    const displayHost = ['0.0.0.0', '::'].includes(hostname)
      ? '127.0.0.1'
      : hostname;
    const url = `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${info.port}`;
    console.log(`c9view listening at ${url}`);
    printLogin(url, auth.token);
    options.onListening?.(url);
  });
  server.once('close', () => {
    void index.close();
  });
  return Object.assign(server, { index });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const server = startServer();
    const shutdown = () => {
      server.close();
      if ('closeAllConnections' in server) server.closeAllConnections();
      void server.index.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Startup failed');
    process.exitCode = 1;
  }
}

// A generated token is only shown on a TTY (never in container logs), so without
// a TTY and without C9VIEW_TOKEN nobody could ever log in.
export function requireRecoverableToken(
  mode: string,
  tokenSet: boolean,
  tty: boolean,
) {
  if (mode === 'token' && !tokenSet && !tty)
    throw new Error(
      'Token auth without a terminal: set C9VIEW_TOKEN (at least 32 characters) so you can log in. A generated token is only shown on a TTY.',
    );
}

export function printLogin(
  url: string,
  token?: string,
  tty = process.stdout.isTTY === true,
) {
  if (!token) return;
  console.log(`Login: ${url}/login`);
  if (tty) console.log(`Token: ${token}`);
  else
    console.log(
      'Use your C9VIEW_TOKEN environment value to log in; set it before starting the server (at least 32 characters).',
    );
}

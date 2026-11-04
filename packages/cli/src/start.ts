import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface StartOptions {
  port?: string;
  host?: string;
  'claude-dir'?: string;
  db?: string;
  'allowed-host'?: string[];
  auth?: string;
  open?: boolean;
}
export async function runStart(options: StartOptions) {
  if (options.port !== undefined && !/^\d+$/.test(options.port))
    throw new Error('--port must be an integer from 1 to 65535');
  if (options.auth && !['none', 'token', 'password'].includes(options.auth))
    throw new Error('--auth must be none, token or password');
  let serverPackage: string;
  try {
    serverPackage = import.meta.resolve('@c9view/server/package.json');
  } catch {
    serverPackage = new URL(
      '../../../apps/server/package.json',
      import.meta.url,
    ).href;
  }
  const entry = new URL('./dist/main.js', serverPackage);
  const { startServer } = (await import(entry.href)) as {
    startServer: (options: Record<string, unknown>) => unknown;
  };
  return startServer({
    ...(options.port !== undefined ? { port: Number(options.port) } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options['claude-dir'] ? { claudeDir: options['claude-dir'] } : {}),
    ...(options.db ? { db: options.db } : {}),
    ...(options['allowed-host']
      ? { allowedHosts: options['allowed-host'] }
      : {}),
    ...(options.auth ? { auth: options.auth } : {}),
    // Repository layout fallback; deployed containers set C9VIEW_WEB_DIST.
    webDist:
      process.env.C9VIEW_WEB_DIST ??
      fileURLToPath(new URL('../web/dist/', serverPackage)),
    ...(options.open ? { onListening: openBrowser } : {}),
  });
}
function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32'
        : 'xdg-open';
  const child = spawn(
    command,
    process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', () =>
    console.warn('Could not open browser; use the URL printed above.'),
  );
  child.unref();
}

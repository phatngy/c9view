import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHub } from './hub-loader.js';

export interface StartOptions {
  control?: boolean;
  bypass?: boolean;
  port?: string;
  host?: string;
  'claude-dir'?: string;
  db?: string;
  'allowed-host'?: string[];
  'workspace-root'?: string[];
  auth?: string;
  open?: boolean;
}
export async function runStart(options: StartOptions) {
  if (options.port !== undefined && !/^\d+$/.test(options.port))
    throw new Error('--port must be an integer from 1 to 65535');
  if (options.auth && !['none', 'token', 'password'].includes(options.auth))
    throw new Error('--auth must be none, token or password');
  if (
    (options.bypass ?? process.env.C9VIEW_CONTROL_BYPASS === '1') &&
    !(options.control ?? process.env.C9VIEW_CONTROL === '1')
  )
    throw new Error(
      '--bypass requires control. Add --control or set C9VIEW_CONTROL=1.',
    );
  const hubPackage = hubPackageUrl();
  const entry = new URL('./dist/main.js', hubPackage);
  const { startServer } = await loadHub(entry);
  return startServer({
    ...(options.control !== undefined ? { control: options.control } : {}),
    ...(options.bypass !== undefined ? { bypass: options.bypass } : {}),
    ...(options.port !== undefined ? { port: Number(options.port) } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options['claude-dir'] ? { claudeDir: options['claude-dir'] } : {}),
    ...(options.db ? { db: options.db } : {}),
    ...(options['allowed-host']
      ? { allowedHosts: options['allowed-host'] }
      : {}),
    ...(options['workspace-root']
      ? {
          workspaceRoots: options['workspace-root'].map((root) =>
            root.startsWith('~') ? root : resolve(root),
          ),
        }
      : {}),
    ...(options.auth ? { auth: options.auth } : {}),
    // Repository layout fallback; deployed containers set C9VIEW_WEB_DIST.
    webDist:
      process.env.C9VIEW_WEB_DIST ??
      fileURLToPath(new URL('../web/dist/', hubPackage)),
    ...(options.open ? { onListening: openBrowser } : {}),
  });
}
/** The hub's package.json: the installed package, else the repository layout. */
export function hubPackageUrl(): string {
  try {
    return import.meta.resolve('@c9view/hub/package.json');
  } catch {
    return new URL('../../../apps/hub/package.json', import.meta.url).href;
  }
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

// Packs the release folder, installs the tarball into a temp prefix and runs it.
// Usage: node --experimental-strip-types scripts/release/smoke.ts [--dir release]
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(cliRoot, '../..');

function step(message: string) {
  console.log(`smoke: ${message}`);
}
function run(command: string, args: string[], cwd: string, env = process.env) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}
async function waitFor<T>(
  what: string,
  attempt: () => Promise<T | undefined>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await attempt().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke check failed: ${message}`);
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string' } } });
  const releaseDir = resolve(values.dir ?? join(cliRoot, 'release'));
  const work = mkdtempSync(join(tmpdir(), 'c9view-smoke-'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    step('npm pack');
    const packed = run(
      'npm',
      ['pack', releaseDir, '--pack-destination', work, '--json'],
      work,
    );
    const tarball = join(
      work,
      (JSON.parse(packed) as { filename: string }[])[0]!.filename,
    );
    const prefix = join(work, 'prefix');
    step('npm install of the tarball');
    run('npm', ['init', '-y', '--prefix', prefix], work);
    run(
      'npm',
      ['install', '--prefix', prefix, '--no-audit', '--no-fund', tarball],
      work,
    );
    const bin = join(prefix, 'node_modules/.bin/c9view');
    const home = join(work, 'home');
    const claudeDir = join(work, 'claude');
    cpSync(join(repoRoot, 'tests/fixtures/claude'), claudeDir, {
      recursive: true,
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      C9VIEW_CLAUDE_DIR: claudeDir,
      C9VIEW_DB: join(work, 'index.sqlite'),
      C9VIEW_STATE_DIR: join(work, 'state'),
      C9VIEW_AUTH: 'none',
    };
    delete env.C9VIEW_WEB_DIST;

    step('c9view --help');
    expect(run(bin, ['--help'], work, env).includes('Usage:'), '--help usage');

    step('c9view scan --json');
    const summary: unknown = JSON.parse(
      run(bin, ['scan', '--json'], work, env),
    );
    expect(typeof summary === 'object' && summary !== null, 'scan prints JSON');
    console.log(`smoke: scan summary ${JSON.stringify(summary)}`);

    step('c9view hooks install points at an existing file');
    const settingsDir = join(work, 'hook-claude');
    run(bin, ['hooks', 'install', '--yes', '--claude-dir', settingsDir], work, {
      ...env,
      C9VIEW_STATE_DIR: join(work, 'hook-state'),
    });
    const settings = readFileSync(join(settingsDir, 'settings.json'), 'utf8');
    const entry = /'([^']*hook-entry\.js)'/.exec(settings)?.[1];
    expect(entry && existsSync(entry), 'installed hook entry file exists');

    step('c9view start');
    const port = await freePort();
    child = spawn(bin, ['start', '--port', String(port)], {
      cwd: work,
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
    const base = `http://127.0.0.1:${port}`;
    await waitFor('/api/health', async () => {
      const response = await fetch(`${base}/api/health`);
      return response.ok && ((await response.json()) as { ok?: boolean }).ok
        ? true
        : undefined;
    });
    const page = await fetch(`${base}/`);
    expect(page.ok, '/ responds');
    const html = await page.text();
    const expected = readFileSync(
      join(releaseDir, 'web-dist/index.html'),
      'utf8',
    );
    expect(html.trim() === expected.trim(), '/ serves the web index.html');
    step('ok');
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((r) => {
        child?.once('exit', r);
        setTimeout(r, 5000);
      });
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(work, { recursive: true, force: true });
  }
}
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

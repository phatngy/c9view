// Shared by scripts/record-api-snapshots.ts (run before the hub/node split) and
// apps/hub/src/split.e2e.test.ts (run after it): the same routes, fetched the
// same way and normalised the same way, must give byte-identical snapshots.
// node: built-ins only, so the recorder runs with --experimental-strip-types.
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT_DIR = fileURLToPath(
  new URL('../tests/fixtures/api-snapshots/', import.meta.url),
);
const FIXTURE = fileURLToPath(
  new URL('../tests/fixtures/claude/', import.meta.url),
);

const alpha = '/api/projects/-synthetic-alpha';
const one = `${alpha}/sessions/session-one`;

/** Every /api/* route with the fixture's IDs, plus error and edge cases. */
export const ROUTES: readonly { name: string; path: string }[] = [
  { name: 'health', path: '/api/health' },
  { name: 'events', path: '/api/events' },
  { name: 'overview', path: '/api/overview' },
  { name: 'projects', path: '/api/projects' },
  { name: 'project-alpha', path: alpha },
  { name: 'project-beta', path: '/api/projects/-synthetic-beta' },
  { name: 'project-missing', path: '/api/projects/-synthetic-missing' },
  { name: 'session-one', path: one },
  { name: 'session-one-end', path: `${one}?from=end&limit=2` },
  { name: 'session-one-page', path: `${one}?cursor=1&limit=1` },
  { name: 'session-two', path: `${alpha}/sessions/session-two` },
  {
    name: 'session-three',
    path: '/api/projects/-synthetic-beta/sessions/session-three',
  },
  {
    name: 'session-subagent',
    path: `${alpha}/sessions/session-one%2Fagent-child-one`,
  },
  { name: 'session-missing', path: `${alpha}/sessions/session-missing` },
  { name: 'session-status', path: `${one}/status` },
  { name: 'session-status-history', path: `${one}/status/history` },
  { name: 'session-changes', path: `${one}/changes` },
  { name: 'session-change-missing', path: `${one}/changes/missing` },
  { name: 'files', path: `${alpha}/files` },
  { name: 'file', path: `${alpha}/file?path=README.md` },
  { name: 'git-status', path: `${alpha}/git/status` },
  { name: 'git-diff', path: `${alpha}/git/diff` },
  { name: 'config', path: '/api/config' },
  { name: 'usage', path: '/api/usage?from=2026-01-01&to=2026-01-31&tz=UTC' },
  {
    name: 'usage-project',
    path: '/api/usage?from=2026-01-01&to=2026-01-31&projectId=-synthetic-alpha',
  },
  { name: 'usage-invalid', path: '/api/usage?from=2026-13-01' },
  { name: 'search', path: '/api/search?q=widget' },
  {
    name: 'search-project',
    path: '/api/search?q=sample&projectId=-synthetic-alpha&limit=1',
  },
  { name: 'search-invalid', path: '/api/search' },
  { name: 'api-root', path: '/api' },
  { name: 'api-unknown', path: '/api/unknown' },
];

export interface Snapshot {
  path: string;
  status: number;
  contentType: string;
  body: unknown;
}

export interface FixtureDirs {
  root: string;
  claudeDir: string;
  stateDir: string;
  db: string;
}

/** Copies the synthetic fixture to a temporary folder so nothing writes into the repo. */
export async function prepareFixture(): Promise<FixtureDirs> {
  const root = await mkdtemp(join(tmpdir(), 'c9view-snapshots-'));
  const claudeDir = join(root, 'claude');
  await cp(FIXTURE, claudeDir, { recursive: true });
  return {
    root,
    claudeDir,
    stateDir: join(root, 'state'),
    db: join(root, 'index.sqlite'),
  };
}

export async function fetchSnapshot(
  baseUrl: string,
  path: string,
  dirs: FixtureDirs,
): Promise<Snapshot> {
  const controller = new AbortController();
  const response = await fetch(new URL(path, baseUrl), {
    signal: controller.signal,
  });
  const contentType = response.headers.get('content-type') ?? '';
  let body: unknown;
  if (contentType.startsWith('text/event-stream')) {
    // A stream never ends: keep its first frame and disconnect.
    const reader = response.body!.getReader();
    const first = await reader.read();
    body = new TextDecoder().decode(first.value);
    controller.abort();
    await reader.cancel().catch(() => {});
  } else body = await response.json();
  return {
    path,
    status: response.status,
    contentType,
    body: normalize(body, dirs),
  };
}

/**
 * Replaces temporary paths and clock readings so runs on different days match:
 * the index scan time, and the time a status change was observed (status
 * history entries carry `column` and `reason`; other `at` fields come from the
 * fixture and stay).
 */
export function normalize(value: unknown, dirs: FixtureDirs): unknown {
  if (typeof value === 'string')
    return value
      .replaceAll(dirs.claudeDir, '<claudeDir>')
      .replaceAll(dirs.stateDir, '<stateDir>')
      .replaceAll(dirs.root, '<root>');
  if (Array.isArray(value)) return value.map((v) => normalize(v, dirs));
  if (value && typeof value === 'object') {
    const observed = 'column' in value && 'reason' in value;
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        typeof v === 'string' &&
        (key === 'lastFullScanAt' || (observed && key === 'at'))
          ? '<timestamp>'
          : normalize(v, dirs),
      ]),
    );
  }
  return value;
}

export function serialize(snapshot: Snapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/** Polls health until the index is ready, so every snapshot sees indexed data. */
export async function waitForReady(baseUrl: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/api/health', baseUrl));
      const health = (await response.json()) as { index?: { state?: string } };
      if (health.index?.state === 'ready') return;
    } catch {
      /* Not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Index did not become ready');
}

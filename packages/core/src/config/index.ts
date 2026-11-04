import { homedir, platform } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  claudeDir: z.string().min(1),
  workspaceRoots: z.array(z.string()),
  dbPath: z.string().min(1),
});

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function cacheDirectory(env: NodeJS.ProcessEnv): string {
  if (env.XDG_CACHE_HOME) return expandHome(env.XDG_CACHE_HOME);
  if (platform() === 'win32')
    return env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
  if (platform() === 'darwin') return path.join(homedir(), 'Library', 'Caches');
  return path.join(homedir(), '.cache');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): {
  claudeDir: string;
  workspaceRoots: string[];
  dbPath: string;
} {
  const delimiter = path.delimiter;
  return configSchema.parse({
    claudeDir: expandHome(
      env.C9VIEW_CLAUDE_DIR || path.join(homedir(), '.claude'),
    ),
    workspaceRoots: (env.C9VIEW_WORKSPACE_ROOTS || '')
      .split(delimiter)
      .map((entry) => expandHome(entry.trim()))
      .filter(Boolean),
    dbPath: expandHome(
      env.C9VIEW_DB || path.join(cacheDirectory(env), 'c9view', 'index.sqlite'),
    ),
  });
}

import { isC9viewStatePath } from '../state/ignore.js';
import { hookStateDir } from '../hooks/state-dir.js';
import { assertClaudeDir } from '../index-db/paths.js';
import { loadPrices } from '../pricing/index.js';
import chokidar from 'chokidar';
import path from 'node:path';
import { listSubagents } from '../transcript/index.js';
import {
  deleteSession,
  indexSession,
  type IndexConfig,
  type IndexDatabase,
} from '../index-db/indexer.js';
export interface IndexChangeEvent {
  kind: 'session' | 'project' | 'config' | 'live-status';
  id: string;
}
/** Watches directories because chokidar 4+ deliberately does not expand globs. */
export function watchClaudeDir(
  config: IndexConfig,
  db: IndexDatabase,
  onChange: (event: IndexChangeEvent) => void,
  onError: (error: unknown) => void = () => {},
) {
  assertClaudeDir(config.claudeDir);
  const stateDir = hookStateDir();
  const prices = loadPrices();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let queue = Promise.resolve();
  let closed = false;
  const watcher = chokidar.watch(
    [
      path.join(config.claudeDir, 'projects'),
      path.join(config.claudeDir, 'sessions'),
      config.claudeDir,
    ],
    {
      ignoreInitial: true,
      depth: 5,
      awaitWriteFinish: false,
      ignored: (file, stats) =>
        isC9viewStatePath(config.claudeDir, stateDir, file) ||
        (!!stats?.isDirectory() &&
          ![
            config.claudeDir,
            path.join(config.claudeDir, 'projects'),
            path.join(config.claudeDir, 'sessions'),
          ].includes(file) &&
          !file.startsWith(path.join(config.claudeDir, 'projects') + path.sep)),
    },
  );
  watcher.on('all', (_event, file) => {
    if (isC9viewStatePath(config.claudeDir, stateDir, file)) return;
    const relative = path.relative(config.claudeDir, file);
    const parts = relative.split(path.sep);
    const transcript =
      parts[0] === 'projects' &&
      file.endsWith('.jsonl') &&
      (parts.length === 3 ||
        (parts.length === 5 &&
          parts[3] === 'subagents' &&
          path.basename(file).startsWith('agent-')));
    const live = parts[0] === 'sessions' && file.endsWith('.json');
    const configuration =
      parts.length === 1 &&
      /^(settings.*\.json|stats-cache\.json)$/.test(relative);
    if (!transcript && !live && !configuration) return;
    clearTimeout(timers.get(file));
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        queue = queue
          .then(async () => {
            if (closed) return;
            if (transcript) {
              if (_event === 'unlink')
                deleteSession(
                  db,
                  parts.length > 3
                    ? `${parts[2]}/${path.basename(file, '.jsonl')}`
                    : path.basename(file, '.jsonl'),
                  await prices,
                );
              else {
                await indexSession(db, file, {
                  projectId: parts[1]!,
                  prices: await prices,
                  ...(parts.length > 3
                    ? { isSubagent: true, parentSessionId: parts[2]! }
                    : {}),
                });
                const parentId =
                  parts.length > 3 ? parts[2]! : path.basename(file, '.jsonl');
                for (const agent of await listSubagents(
                  path.join(config.claudeDir, 'projects', parts[1]!),
                  parentId,
                )) {
                  await indexSession(db, agent.path, {
                    projectId: parts[1]!,
                    prices: await prices,
                    isSubagent: true,
                    parentSessionId: parentId,
                    ...(agent.parentToolUseId
                      ? { parentToolUseId: agent.parentToolUseId }
                      : {}),
                  });
                }
              }
              onChange({
                kind: 'session',
                id:
                  parts.length > 3
                    ? `${parts[2]}/${path.basename(file, '.jsonl')}`
                    : path.basename(file, '.jsonl'),
              });
              onChange({ kind: 'project', id: parts[1]! });
            } else
              onChange({
                kind: live ? 'live-status' : 'config',
                id: path.basename(file),
              });
          })
          .catch(onError);
      }, 250),
    );
  });
  watcher.on('error', onError);
  return {
    ready: new Promise<void>((resolve) => watcher.on('ready', resolve)),
    async close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      await watcher.close();
      await queue;
    },
  };
}

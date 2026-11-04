import { HookEvents } from './hook-events.js';
import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';
import {
  TranscriptStatusCache,
  discoverProjects,
  listProjects,
  getSession,
  listSubagents,
  type IndexDatabase,
  resolveProjectPath,
  type loadConfig,
  type DiscoveredProject,
} from '@c9view/core';
import type {
  ProjectSummary,
  SessionSummary,
  TokenTotals,
  KanbanColumn,
} from '@c9view/api';
import { TranscriptCache } from './cache.js';
import { classifyStatus, pidNamespace, readLiveEntries } from './status.js';
import { tokens } from './messages.js';
import {
  indexedEntry,
  indexedModels,
  subagentTotals,
  snapshotSessions,
  type IndexedSession,
} from './indexed.js';
import { EventHub } from './events.js';
import type { IndexHealth } from '@c9view/api';

export type ServerConfig = ReturnType<typeof loadConfig>;
export const columns = (): Record<KanbanColumn, number> => ({
  inactive: 0,
  in_progress: 0,
  need_input: 0,
  in_review: 0,
});
export const zeroTokens = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  thinking: 0,
});
export function sumTokens(values: TokenTotals[]): TokenTotals {
  const sum = zeroTokens();
  for (const value of values)
    for (const key of Object.keys(sum) as (keyof TokenTotals)[])
      sum[key] += value[key];
  return sum;
}
export interface SnapshotProject {
  discovered: DiscoveredProject;
  project: ProjectSummary;
  sessions: SessionSummary[];
}
export class DataStore {
  index: IndexDatabase | undefined;
  indexHealth: IndexHealth = { state: 'building', lastFullScanAt: null };
  readonly events = new EventHub();
  private generation = 0;
  private dirtyProjects = new Set<string>();
  private modelVersion = -1;
  private modelDb?: IndexDatabase;
  private modelTotals?: import('@c9view/api').OverviewResponse['byModel'];
  invalidate(projectId?: string) {
    if (projectId && this.snapshotValue) this.dirtyProjects.add(projectId);
    else {
      this.dirtyProjects.clear();
      delete this.snapshotValue;
    }
    this.generation++;
    this.snapshotUntil = 0;
  }
  get readyIndex() {
    return this.indexHealth.state === 'ready' ? this.index : undefined;
  }
  readonly transcriptStatus = new TranscriptStatusCache();
  readonly hooks: HookEvents;
  readonly cache = new TranscriptCache();
  constructor(
    readonly config: ServerConfig,
    options: { hooks?: HookEvents } = {},
  ) {
    this.hooks = options.hooks ?? new HookEvents();
  }
  private snapshotValue?: SnapshotProject[];
  private snapshotUntil = 0;
  private snapshotFlight: Promise<SnapshotProject[]> | undefined;
  snapshot() {
    if (this.snapshotValue && Date.now() < this.snapshotUntil)
      return Promise.resolve(this.snapshotValue);
    if (this.snapshotFlight) return this.snapshotFlight;
    const generation = this.generation;
    this.snapshotFlight = this.buildSnapshot()
      .then((value) => {
        if (generation === this.generation) {
          this.dirtyProjects.clear();
          this.snapshotValue = value;
          this.snapshotUntil = Date.now() + 1500;
        }
        return value;
      })
      .finally(() => {
        this.snapshotFlight = undefined;
      });
    return this.snapshotFlight;
  }
  private async buildSnapshot(): Promise<SnapshotProject[]> {
    await this.hooks.refresh();
    const dirtyProjects = new Set(this.dirtyProjects);
    const previousProjects = new Map(
      this.snapshotValue?.map((p) => [p.project.id, p]),
    );
    const db = this.readyIndex;
    const projectMap = new Map(
      db ? listProjects(db).map((p) => [p.id, p]) : [],
    );
    const sessionMap = new Map<string, IndexedSession>();
    const projectSessions = new Map<string, IndexedSession[]>();
    for (const session of db ? snapshotSessions(db) : []) {
      sessionMap.set(session.id, session);
      const list = projectSessions.get(session.projectId) ?? [];
      list.push(session);
      projectSessions.set(session.projectId, list);
    }
    const children = db ? subagentTotals(db) : new Map();
    const [projects, live, namespace] = await Promise.all([
      this.readyIndex
        ? Promise.resolve(
            [...projectMap.values()].map((p) => ({
              id: p.id,
              dir: p.dir,
              hasMemory: false,
              sessionFiles: (projectSessions.get(p.id) ?? []).map((s) => ({
                sessionId: s.id,
                path: s.file,
                size: s.fileSize,
                mtimeMs: s.fileMtimeMs,
              })),
            })),
          )
        : discoverProjects(this.config.claudeDir),
      readLiveEntries(this.config.claudeDir),
      pidNamespace(),
    ]);
    const buildProject = async (
      discovered: DiscoveredProject,
    ): Promise<SnapshotProject> => {
      const previous =
        dirtyProjects.size && !dirtyProjects.has(discovered.id)
          ? previousProjects.get(discovered.id)
          : undefined;
      if (previous) {
        return previous;
      }
      const cwdHints: string[] = [];
      const summaries = await Promise.all(
        discovered.sessionFiles.map(async (file) => {
          let cached;
          try {
            const row = sessionMap.get(file.sessionId);
            cached = row
              ? indexedEntry(this.readyIndex!, row)
              : await this.cache.get(file.path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          }
          if (cached.summary.cwd) cwdHints.push(cached.summary.cwd);
          return this.sessionSummary(
            discovered,
            file,
            cached,
            live,
            namespace,
            false,
            db
              ? (children.get(file.sessionId) ?? {
                  count: 0,
                  tokens: zeroTokens(),
                  costUsd: 0,
                })
              : undefined,
          );
        }),
      );
      const sessions = summaries.filter((s): s is SessionSummary => s !== null);
      const indexedProject = projectMap.get(discovered.id);
      const resolved = indexedProject
        ? { path: indexedProject.path, exists: indexedProject.pathExists }
        : await resolveProjectPath(discovered.id, { cwdHints });
      const counts = columns();
      for (const session of sessions) counts[session.status.column]++;
      const lastActivityAt =
        sessions
          .map((s) => s.lastAt)
          .filter((s): s is string => s !== null)
          .sort()
          .at(-1) ?? null;
      return {
        discovered,
        project: {
          id: discovered.id,
          name: basename(resolved.path),
          path: resolved.path,
          pathExists: resolved.exists,
          sessionCount: sessions.length,
          lastActivityAt,
          columns: counts,
          tokens: sumTokens(sessions.map((s) => s.tokens)),
          costUsd: sessions.reduce((sum, s) => sum + s.costUsd, 0),
        },
        sessions,
      };
    };
    if (db) return Promise.all(projects.map(buildProject));
    const result = [];
    for (const project of projects) result.push(await buildProject(project));
    return result;
  }
  private async sessionSummary(
    discovered: Pick<DiscoveredProject, 'id' | 'dir'>,
    file: { sessionId: string; path?: string },
    cached: Awaited<ReturnType<TranscriptCache['get']>>,
    live: Awaited<ReturnType<typeof readLiveEntries>>,
    namespace: string | undefined,
    poll = false,
    childTotals?: { count: number; tokens: TokenTotals; costUsd: number },
  ): Promise<SessionSummary> {
    const s = cached.summary;
    const entry = live.get(file.sessionId);
    const status = classifyStatus(
      entry,
      [...cached.lastTools.values()].at(-1) ?? null,
      {
        ...(namespace === undefined ? {} : { namespace }),
        hookEvents: this.hooks.events(file.sessionId),
        transcript: await this.transcriptStatus.get(
          file.path ?? join(discovered.dir, `${file.sessionId}.jsonl`),
        ),
      },
    );
    this.hooks.record(file.sessionId, status);
    const child =
      childTotals ??
      (poll
        ? { count: 0, tokens: zeroTokens(), costUsd: 0 }
        : await this.children(discovered.dir, file.sessionId));
    return {
      id: file.sessionId,
      projectId: discovered.id,
      title: s.title ?? file.sessionId,
      firstAt: s.firstAt ? new Date(s.firstAt).toISOString() : null,
      lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
      gitBranch: s.gitBranches.at(-1) ?? null,
      models: s.models,
      messageCount: s.messageCount,
      lastMessagePreview: cached.preview,
      subagentCount: child.count,
      ownTokens: tokens(s.usage.total),
      ownCostUsd: cached.costUsd,
      subagentCostUsd: child.costUsd,
      tokens: sumTokens([tokens(s.usage.total), child.tokens]),
      costUsd: cached.costUsd + child.costUsd,
      status,
      liveName: status.column === 'inactive' ? null : (entry?.name ?? null),
    };
  }
  async findSession(
    projectId: string,
    sessionId: string,
    full = false,
    poll = false,
  ) {
    // Route parameters must be single path components, even after URL decoding.
    if (
      ![projectId, sessionId].every(
        (id) =>
          id !== '.' &&
          id !== '..' &&
          !id.includes('/') &&
          !id.includes('\\') &&
          !id.includes(String.fromCharCode(0)),
      )
    )
      return null;
    await this.hooks.refresh();
    const dir = join(this.config.claudeDir, 'projects', projectId);
    const path = join(dir, `${sessionId}.jsonl`);
    try {
      if (!(await stat(dir)).isDirectory()) return null;
      const [cached, live, namespace] = await Promise.all([
        this.readyIndex
          ? Promise.resolve(getSession(this.readyIndex, sessionId)).then(
              (row) =>
                row?.projectId === projectId
                  ? indexedEntry(this.readyIndex!, row, full)
                  : null,
            )
          : this.cache.get(path, full),
        readLiveEntries(this.config.claudeDir),
        pidNamespace(),
      ]);
      if (!cached) return null;
      const session = await this.sessionSummary(
        { id: projectId, dir },
        { sessionId },
        cached,
        live,
        namespace,
        poll,
        this.readyIndex
          ? (subagentTotals(this.readyIndex).get(sessionId) ?? {
              count: 0,
              tokens: zeroTokens(),
              costUsd: 0,
            })
          : undefined,
      );
      return { dir, path, cached, session };
    } catch (error) {
      if (
        ['ENOENT', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        return null;
      throw error;
    }
  }
  private childPaths = new Map<string, string[]>();
  private async children(dir: string, id: string) {
    const agents = await listSubagents(dir, id);
    this.childPaths.set(
      join(dir, `${id}.jsonl`),
      agents.map((a) => a.path),
    );
    const entries = await Promise.all(
      agents.map((a) => this.cache.get(a.path)),
    );
    return {
      count: agents.length,
      tokens: sumTokens(entries.map((e) => tokens(e.summary.usage.total))),
      costUsd: entries.reduce((n, e) => n + e.costUsd, 0),
    };
  }
  async sessionModels(path: string, id: string) {
    if (this.readyIndex)
      return indexedModels(this.readyIndex, id).sort((a, b) =>
        a.model.localeCompare(b.model),
      );
    const values = [path, ...(this.childPaths.get(path) ?? [])].flatMap(
      (p) => this.cache.peek(p)?.byModel ?? [],
    );
    return [...new Set(values.map((v) => v.model))].sort().map((model) => ({
      model,
      tokens: sumTokens(
        values.filter((v) => v.model === model).map((v) => v.tokens),
      ),
      costUsd: values
        .filter((v) => v.model === model)
        .reduce((n, v) => n + v.costUsd, 0),
    }));
  }
  async byModel(paths: string[]) {
    const version = this.readyIndex
      ? (
          this.readyIndex.sqlite
            .prepare('SELECT total_changes() AS n')
            .get() as { n: number }
        ).n
      : -1;
    if (
      this.readyIndex === this.modelDb &&
      version === this.modelVersion &&
      this.modelTotals
    )
      return this.modelTotals;
    const totals = new Map<string, { tokens: TokenTotals; costUsd: number }>();
    const values = this.readyIndex
      ? indexedModels(this.readyIndex)
      : paths
          .flatMap((path) => [path, ...(this.childPaths.get(path) ?? [])])
          .flatMap((path) => this.cache.peek(path)?.byModel ?? []);
    for (const { model, tokens: usage, costUsd } of values) {
      const prev = totals.get(model);
      totals.set(model, {
        tokens: sumTokens([prev?.tokens ?? zeroTokens(), usage]),
        costUsd: (prev?.costUsd ?? 0) + costUsd,
      });
    }
    const result = [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, value]) => ({ model, ...value }));
    if (this.readyIndex) {
      this.modelTotals = result;
      this.modelDb = this.readyIndex;
      this.modelVersion = version;
    }
    return result;
  }
}

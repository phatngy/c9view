import { assertClaudeDir } from '../index-db/paths.js';
import { performance } from 'node:perf_hooks';
import {
  indexAll,
  openIndex,
  type IndexConfig,
  type IndexDatabase,
} from '../index-db/indexer.js';
import { listProjects } from '../index-db/queries.js';
import { sessions, meta } from '../index-db/schema.js';
export function scanSummary(db: IndexDatabase, elapsedMs: number) {
  const projects = listProjects(db);
  const all = db.orm.select().from(sessions).all();
  const metadata = Object.fromEntries(
    db.orm
      .select()
      .from(meta)
      .all()
      .map((r) => [
        r.key,
        (r.key === 'schemaVersion' ? r.value : JSON.parse(r.value)) as unknown,
      ]),
  );
  const totals = projects.reduce(
    (a, s) => ({
      input: a.input + s.input,
      output: a.output + s.output,
      cacheRead: a.cacheRead + s.cacheRead,
      cacheCreation: a.cacheCreation + s.cacheCreation,
      thinking: a.thinking + s.thinking,
      costUsd: a.costUsd + s.costUsd,
    }),
    {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      thinking: 0,
      costUsd: 0,
    },
  );
  return {
    projects: projects.length,
    sessions: all.filter((s) => !s.isSubagent).length,
    subagentSessions: all.filter((s) => s.isSubagent).length,
    messages: all.reduce((n, s) => n + s.messageCount, 0),
    malformedLines: all.reduce((n, s) => n + s.malformed, 0),
    unknownRecordTypes: (metadata.unknownRecordTypes ?? {}) as Record<
      string,
      number
    >,
    unresolvedProjectPaths: projects.filter((p) => !p.pathExists).length,
    modelsWithoutPrice: (metadata.modelsWithoutPrice ?? {}) as Record<
      string,
      number
    >,
    totalTokens:
      totals.input + totals.output + totals.cacheRead + totals.cacheCreation,
    ...totals,
    elapsedMs,
  };
}
export type ScanSummary = ReturnType<typeof scanSummary>;
export async function scan(config: IndexConfig): Promise<ScanSummary> {
  const start = performance.now();
  assertClaudeDir(config.claudeDir);
  const db = openIndex(config.dbPath, config.claudeDir);
  try {
    await indexAll(db, config);
    return scanSummary(db, performance.now() - start);
  } finally {
    db.close();
  }
}

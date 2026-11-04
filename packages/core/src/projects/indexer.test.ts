import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { indexAll, openIndex } from '../index-db/indexer.js';
import { getSession, listProjects } from '../index-db/queries.js';
import { encodeProjectPath } from './index.js';

it('re-resolves a stored project path on the next scan of unchanged transcripts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'c9view-project-path-'));
  const launch = path.join(root, 'personal');
  const later = path.join(launch, 'ai-website-cloner');
  const projectId = encodeProjectPath(launch);
  const config = {
    claudeDir: path.join(root, 'claude'),
    dbPath: path.join(root, 'index.sqlite'),
    workspaceRoots: [],
  };
  let db: ReturnType<typeof openIndex> | undefined;
  try {
    await mkdir(later, { recursive: true });
    const projectDir = path.join(config.claudeDir, 'projects', projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'session.jsonl'),
      [launch, later, later]
        .map((cwd, index) =>
          JSON.stringify({
            type: 'user',
            uuid: `user-${index}`,
            cwd,
            message: { role: 'user', content: 'Synthetic path test' },
          }),
        )
        .join('\n') + '\n',
    );
    db = openIndex(config.dbPath);
    await indexAll(db, config);
    const session = getSession(db, 'session');
    expect(session?.cwdCounts).toEqual({ [launch]: 1, [later]: 2 });

    // Seed the value an index built by the old most-common-cwd resolver stored.
    db.sqlite
      .prepare('UPDATE projects SET path = ? WHERE id = ?')
      .run(later, projectId);
    db.close();
    db = openIndex(config.dbPath);
    expect(listProjects(db)[0]?.path).toBe(later);

    await indexAll(db, config);

    expect(listProjects(db)[0]).toMatchObject({
      id: projectId,
      path: launch,
      pathExists: true,
      pathSource: 'transcript',
    });
    expect(getSession(db, 'session')).toEqual(session);
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendFile,
  cp,
  mkdtemp,
  rm,
  writeFile,
  rename,
  symlink,
  access,
  open,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexAll, indexSession, openIndex } from './indexer.js';
import {
  getMessages,
  getSession,
  listProjects,
  listSessions,
  readRawRecords,
  search,
  usageByDay,
  usageByModel,
} from './queries.js';
import * as pricing from '../pricing/index.js';
import * as indexer from './indexer.js';
import { scan, scanSummary } from '../scan/index.js';
import { watchClaudeDir } from '../watch/index.js';
const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporary.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'c9view-index-'));
  temporary.push(dir);
  const claudeDir = path.join(dir, 'claude');
  await cp(
    fileURLToPath(
      new URL('../../../../tests/fixtures/claude', import.meta.url),
    ),
    claudeDir,
    { recursive: true },
  );
  return {
    claudeDir,
    dbPath: path.join(dir, 'index.sqlite'),
    workspaceRoots: [],
  };
}
const appended = (uuid: string, mid: string, n = 30) =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: '2026-01-02T12:00:00Z',
    message: {
      id: mid,
      model: 'claude-sonnet-4-5',
      role: 'assistant',
      content: [{ type: 'text', text: 'Append searchable sample' }],
      usage: { input_tokens: n, output_tokens: 40 },
    },
  });
describe('SQLite index', () => {
  it('indexes synthetic projects, subagents, redacted search, paging and raw records', async () => {
    const config = await setup();
    const db = openIndex(config.dbPath);
    try {
      await indexAll(db, config);
      expect(listProjects(db)).toHaveLength(2);
      expect(listSessions(db, '-synthetic-alpha')).toHaveLength(3);
      const child = getSession(db, 'session-one/agent-child-one');
      expect(child).toMatchObject({
        isSubagent: true,
        parentSessionId: 'session-one',
        parentToolUseId: 'tool-one',
      });
      expect(getSession(db, 'session-one')).toMatchObject({
        input: 10,
        output: 20,
        messageCount: 3,
      });
      expect(usageByModel(db)).toHaveLength(2);
      expect(usageByDay(db)).toHaveLength(1);
      expect(search(db, 'sk-ant-fakeSyntheticSecret12345')).toHaveLength(0);
      expect(
        search(db, 'widget', { projectId: '-synthetic-alpha' }).length,
      ).toBeGreaterThan(0);
      const raw = await readRawRecords(db, 'session-two', ['user-two']);
      expect(JSON.stringify(raw)).toContain('redacted');
      expect(JSON.stringify(raw)).not.toContain('fakeSyntheticSecret');
      const first = getMessages(db, 'session-one', { limit: 1 });
      expect(
        getMessages(db, 'session-one', {
          cursor: first[0]!.byteOffset,
          limit: 1,
        })[0]!.uuid,
      ).not.toBe(first[0]!.uuid);
      expect(scanSummary(db, 0).modelsWithoutPrice).toHaveProperty(
        'synthetic-unknown-model',
      );
    } finally {
      db.close();
    }
  });
  it('deduplicates usage across incremental chunks and equals a full rebuild, including partial and malformed lines', async () => {
    const config = await setup();
    const db = openIndex(config.dbPath);
    const fresh = openIndex(':memory:');
    try {
      await indexAll(db, config);
      const file = path.join(
        config.claudeDir,
        'projects/-synthetic-alpha/session-one.jsonl',
      );
      await appendFile(
        file,
        appended('append-one', 'message-one') +
          '\nmalformed\n' +
          appended('append-two', 'message-new').slice(0, 30),
      );
      await indexSession(db, file);
      expect(getSession(db, 'session-one')).toMatchObject({
        input: 30,
        output: 40,
        malformed: 1,
      });
      await appendFile(
        file,
        appended('append-two', 'message-new').slice(30) + '\n',
      );
      await indexSession(db, file);
      await indexAll(fresh, config);
      expect(scanSummary(db, 0)).toEqual(scanSummary(fresh, 0));
      expect(getSession(db, 'session-one')).toEqual(
        getSession(fresh, 'session-one'),
      );
      expect(usageByDay(db)).toEqual(usageByDay(fresh));
    } finally {
      db.close();
      fresh.close();
    }
  });
  it('infers subagent identity and parent links for direct single-file indexing', async () => {
    const config = await setup();
    const db = openIndex(config.dbPath);
    try {
      await indexSession(
        db,
        path.join(
          config.claudeDir,
          'projects/-synthetic-alpha/session-one/subagents/agent-child-one.jsonl',
        ),
      );
      expect(getSession(db, 'session-one/agent-child-one')).toMatchObject({
        projectId: '-synthetic-alpha',
        isSubagent: true,
        parentSessionId: 'session-one',
        parentToolUseId: 'tool-one',
      });
    } finally {
      db.close();
    }
  });
  it('keeps titles, validates known record shapes and preserves exact UTF-8 byte ranges', async () => {
    const config = await setup();
    const db = openIndex(config.dbPath);
    try {
      await indexAll(db, config);
      const file = path.join(
        config.claudeDir,
        'projects/-synthetic-alpha/session-one.jsonl',
      );
      const text =
        'Unicode café 🌱 ' +
        'x'.repeat(22000) +
        ' sk-ant-fakeSyntheticSecret12345';
      await appendFile(
        file,
        JSON.stringify({ type: 'user' }) +
          '\n' +
          JSON.stringify({
            type: 'user',
            uuid: 'unicode-record',
            message: { role: 'user', content: text },
          }) +
          '\n',
      );
      await indexSession(db, file);
      expect(getSession(db, 'session-one')).toMatchObject({
        title: 'Sample widget',
        malformed: 1,
      });
      expect(
        getMessages(db, 'session-one').find((r) => r.uuid === 'unicode-record')
          ?.text.length,
      ).toBe(20000);
      const raw = await readRawRecords(db, 'session-one', ['unicode-record']);
      expect(JSON.stringify(raw)).toContain('café 🌱');
      expect(JSON.stringify(raw)).toContain('redacted');
      expect(JSON.stringify(raw)).not.toContain('fakeSyntheticSecret');
    } finally {
      db.close();
    }
  });
  it('rebuilds replaced and truncated files, removes deleted files and rebuilds version mismatches', async () => {
    const config = await setup();
    let db = openIndex(config.dbPath);
    try {
      await indexAll(db, config);
      const file = path.join(
        config.claudeDir,
        'projects/-synthetic-alpha/session-two.jsonl',
      );
      await writeFile(
        file + '.new',
        appended('replacement', 'new-message', 99) + '\n',
      );
      await rename(file + '.new', file);
      await indexSession(db, file);
      expect(getSession(db, 'session-two')?.input).toBe(99);
      await writeFile(file, '');
      await indexSession(db, file);
      expect(getSession(db, 'session-two')?.input).toBe(0);
      await rm(file);
      await indexAll(db, config);
      expect(getSession(db, 'session-two')).toBeUndefined();
      db.sqlite
        .prepare("UPDATE meta SET value='0' WHERE key='schemaVersion'")
        .run();
      db.close();
      db = openIndex(config.dbPath);
      expect(listProjects(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
  it('watches transcript appends and config/status changes', async () => {
    const config = await setup();
    const db = openIndex(config.dbPath);
    await indexAll(db, config);
    const events: { kind: string; id: string }[] = [];
    const errors: unknown[] = [];
    const watcher = watchClaudeDir(
      config,
      db,
      (e) => events.push(e),
      (e) => errors.push(e),
    );
    try {
      await watcher.ready;
      await appendFile(
        path.join(
          config.claudeDir,
          'projects/-synthetic-alpha/session-two.jsonl',
        ),
        appended('watch-append', 'watch-message') + '\n',
      );
      await writeFile(path.join(config.claudeDir, 'settings.local.json'), '{}');
      await writeFile(path.join(config.claudeDir, 'sessions/789.json'), '{}');
      await expect
        .poll(() => events.map((e) => e.kind), { timeout: 5000 })
        .toEqual(
          expect.arrayContaining([
            'session',
            'project',
            'config',
            'live-status',
          ]),
        );
      expect(errors).toEqual([]);
      expect(getSession(db, 'session-two')?.input).toBe(40);
    } finally {
      await watcher.close();
      db.close();
    }
  });
});

it('preserves resumed rows, raw file offsets and FTS matches independent of index order', async () => {
  const config = await setup();
  const dir = path.join(config.claudeDir, 'projects/-synthetic-alpha');
  const a = path.join(dir, 'resume-a.jsonl');
  const b = path.join(dir, 'resume-b.jsonl');
  const shared = appended('shared-uuid', 'shared-message', 11);
  const resumed = shared.replace('Append searchable sample', 'ResumeOnly');
  await writeFile(a, shared + '\n' + appended('only-a', 'a', 2) + '\n');
  await writeFile(
    b,
    JSON.stringify({ type: 'system', uuid: 'preamble' }) +
      '\n' +
      resumed +
      '\n' +
      appended('only-b', 'b', 3).replace(
        'Append searchable sample',
        'Distinctive',
      ) +
      '\n',
  );
  const snapshots = [];
  for (const order of [
    [a, b],
    [b, a],
  ]) {
    const db = openIndex(':memory:');
    try {
      for (const file of order) await indexSession(db, file);
      expect(getMessages(db, 'resume-a')).toHaveLength(2);
      expect(getMessages(db, 'resume-b')).toHaveLength(3);
      expect(getSession(db, 'resume-a')?.input).toBe(13);
      expect(getSession(db, 'resume-b')?.input).toBe(14);
      expect(listProjects(db)[0]?.input).toBe(16);
      expect(usageByDay(db)[0]?.input).toBe(16);
      expect(scanSummary(db, 0).input).toBe(16);
      expect(await readRawRecords(db, 'resume-a', ['shared-uuid'])).toEqual([
        JSON.parse(shared),
      ]);
      expect(await readRawRecords(db, 'resume-b', ['shared-uuid'])).toEqual([
        JSON.parse(resumed),
      ]);
      expect(search(db, 'ResumeOnly').map((r) => r.message.sessionId)).toEqual([
        'resume-b',
      ]);
      expect(search(db, 'Distinctive').map((r) => r.message.sessionId)).toEqual(
        ['resume-b'],
      );
      snapshots.push({
        projects: listProjects(db),
        daily: usageByDay(db),
        sessions: listSessions(db, '-synthetic-alpha'),
        rows: ['resume-a', 'resume-b'].map((id) => getMessages(db, id)),
      });
      indexer.deleteSession(db, 'resume-a', await pricing.loadPrices());
      expect(listProjects(db)[0]?.input).toBe(14);
      expect(usageByDay(db)[0]?.input).toBe(14);
      expect(search(db, 'ResumeOnly')).toHaveLength(1);
    } finally {
      db.close();
    }
  }
  expect(snapshots[0]).toEqual(snapshots[1]);
});

it('rejects missing Claude directories before creating a scan DB or watcher', async () => {
  const config = await setup();
  config.claudeDir = path.join(config.claudeDir, 'missing');
  await expect(scan(config)).rejects.toThrow('Claude directory');
  await expect(access(config.dbPath)).rejects.toThrow();
  const db = openIndex(':memory:');
  try {
    expect(() => watchClaudeDir(config, db, () => {})).toThrow(
      'Claude directory',
    );
  } finally {
    db.close();
  }
});

it('rejects databases within the Claude directory through real paths and symlinked parents', async () => {
  const config = await setup();
  const alias = path.join(path.dirname(config.claudeDir), 'alias');
  await symlink(config.claudeDir, alias);
  for (const root of [config.claudeDir, alias]) {
    config.dbPath = path.join(root, 'new', 'index.sqlite');
    expect(() => openIndex(config.dbPath, config.claudeDir)).toThrow('outside');
    await expect(scan(config)).rejects.toThrow('outside');
    await expect(access(path.join(root, 'new'))).rejects.toThrow();
  }
  const inside = path.join(config.claudeDir, 'existing.sqlite');
  await writeFile(inside, '');
  const outsideLink = path.join(path.dirname(config.claudeDir), 'db-link');
  await symlink(inside, outsideLink);
  expect(() => openIndex(outsideLink, config.claudeDir)).toThrow('outside');
  const outside = path.join(path.dirname(config.claudeDir), 'outside.sqlite');
  await writeFile(outside, '');
  const insideLink = path.join(config.claudeDir, 'db-link');
  await symlink(outside, insideLink);
  expect(() => openIndex(insideLink, config.claudeDir)).toThrow('outside');
});

it('treats control characters and FTS syntax as safe literal searches', async () => {
  const config = await setup();
  const db = openIndex(':memory:');
  try {
    await indexAll(db, config);
    expect(search(db, '\u0000widget')).toEqual(search(db, 'widget'));
    for (const query of ['\u0000x', '"', '*', 'NEAR(', '(widget', 'widget)']) {
      expect(() => search(db, query)).not.toThrow();
    }
    db.sqlite.exec('DROP TABLE messages_fts');
    expect(search(db, 'widget')).toEqual([]);
  } finally {
    db.close();
  }
});

it('reindexes an in-place edit after 4 KB when the file also grows', async () => {
  const config = await setup();
  const file = path.join(
    config.claudeDir,
    'projects/-synthetic-alpha/edited.jsonl',
  );
  const first =
    JSON.stringify({
      type: 'system',
      uuid: 'padding',
      padding: 'x'.repeat(5000),
    }) + '\n';
  const old = first + appended('edited', 'edited-message', 11) + '\n';
  await writeFile(file, old);
  const db = openIndex(':memory:');
  const fresh = openIndex(':memory:');
  try {
    await indexSession(db, file);
    const position =
      Buffer.byteLength(old.slice(0, old.indexOf('"input_tokens":11'))) +
      '"input_tokens":'.length;
    const handle = await open(file, 'r+');
    try {
      await handle.write(Buffer.from('99'), 0, 2, position);
    } finally {
      await handle.close();
    }
    await appendFile(file, appended('new', 'new-message', 7) + '\n');
    await indexSession(db, file);
    await indexSession(fresh, file);
    expect(getSession(db, 'edited')?.input).toBe(106);
    expect(getSession(db, 'edited')).toEqual(getSession(fresh, 'edited'));
    expect(getMessages(db, 'edited')).toEqual(getMessages(fresh, 'edited'));
  } finally {
    db.close();
    fresh.close();
  }
});

it('deletes only the unlinked session and its children and loads watcher prices once', async () => {
  const config = await setup();
  const db = openIndex(':memory:');
  await indexAll(db, config);
  const full = vi.spyOn(indexer, 'indexAll');
  const prices = vi.spyOn(pricing, 'loadPrices');
  const errors: unknown[] = [];
  const watcher = watchClaudeDir(
    config,
    db,
    () => {},
    (e) => errors.push(e),
  );
  try {
    await watcher.ready;
    // Unlink must leave the other indexed transcript untouched.
    const other = path.join(
      config.claudeDir,
      'projects/-synthetic-alpha/session-two.jsonl',
    );
    const previous = getSession(db, 'session-two');
    await rm(
      path.join(
        config.claudeDir,
        'projects/-synthetic-alpha/session-one.jsonl',
      ),
    );
    await expect
      .poll(() => getSession(db, 'session-one'), { timeout: 5000 })
      .toBeUndefined();
    expect(getSession(db, 'session-one/agent-child-one')).toBeUndefined();
    expect(getSession(db, 'session-two')).toEqual(previous);
    expect(
      listProjects(db).find((p) => p.id === '-synthetic-alpha')?.sessionCount,
    ).toBe(1);
    await appendFile(other, appended('watch-new', 'watch-new', 17) + '\n');
    await expect
      .poll(() => getSession(db, 'session-two')?.input, { timeout: 5000 })
      .toBe(27);
    await appendFile(other, appended('watch-next', 'watch-next', 1) + '\n');
    await expect
      .poll(() => getSession(db, 'session-two')?.input, { timeout: 5000 })
      .toBe(28);
    expect(full).not.toHaveBeenCalled();
    expect(prices).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  } finally {
    await watcher.close();
    db.close();
  }
});

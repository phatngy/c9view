import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  candidatePaths,
  decodeProjectDir,
  discoverProjects,
  encodeProjectPath,
  readProjectMemory,
  resolveProjectPath,
} from './index.js';

const roots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'c9view-projects-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('project readers', () => {
  it('encodes every non-ASCII-alphanumeric character as one dash', () => {
    expect(encodeProjectPath('/home/Me9/.ao/my-work_under score!')).toBe(
      '-home-Me9--ao-my-work-under-score-',
    );
    expect(encodeProjectPath('/é/中文')).toBe('-----');
    expect(encodeProjectPath(decodeProjectDir('-home-me--ao-data'))).toBe(
      '-home-me--ao-data',
    );
  });

  it('prefers a matching launch directory over a more frequent later cwd', async () => {
    const root = await makeTempDir();
    const launch = path.join(root, 'personal');
    const later = path.join(launch, 'ai-website-cloner');
    await mkdir(later, { recursive: true });

    expect(
      await resolveProjectPath(encodeProjectPath(launch), {
        cwdHints: [launch, later, later, later],
      }),
    ).toEqual({ path: launch, exists: true, source: 'transcript' });
  });

  it('chooses the most frequent matching hint when encodings collide', async () => {
    const root = await makeTempDir();
    const rare = path.join(root, 'my-work');
    const common = path.join(root, 'my_work');
    const unrelated = path.join(root, 'unrelated');

    expect(
      await resolveProjectPath(encodeProjectPath(rare), {
        cwdHints: [rare, common, unrelated, unrelated, unrelated, common],
      }),
    ).toEqual({ path: common, exists: false, source: 'transcript' });
  });

  it('falls back to decoding when there are no valid hints or filesystem paths', async () => {
    expect(
      await resolveProjectPath('-c9view-nonexistent-r9-project', {
        cwdHints: ['relative/path', ''],
      }),
    ).toEqual({
      path: '/c9view/nonexistent/r9/project',
      exists: false,
      source: 'decoded',
    });
  });

  it('decodes and enumerates plausible path candidates', () => {
    expect(decodeProjectDir('-home-me--ao-data')).toBe('/home/me/.ao/data');
    expect(candidatePaths('-home-me--ao-data')).toContain('/home/me/.ao/data');
  });

  it('prefers the most frequent transcript cwd and finds filesystem candidates', async () => {
    const root = await makeTempDir();
    const actual = path.join(root, 'my-work');
    await mkdir(actual);
    const hinted = await resolveProjectPath('no-match', {
      cwdHints: [actual, '/missing', actual],
    });
    expect(hinted).toEqual({
      path: actual,
      exists: true,
      source: 'transcript',
    });

    const encoded = encodeProjectPath(actual);
    const filesystem = await resolveProjectPath(encoded);
    expect(filesystem).toEqual({
      path: actual,
      exists: true,
      source: 'filesystem',
    });
  });

  it('walks deeply encoded paths with punctuation and literal hyphens', async () => {
    const root = await makeTempDir();
    const actual = path.join(
      root,
      'space dir',
      'under_score',
      'many-hyphens-here',
      'last level',
    );
    await mkdir(actual, { recursive: true });
    const encoded = encodeProjectPath(actual);
    expect(candidatePaths(encoded)).toHaveLength(1);
    expect(await resolveProjectPath(encoded)).toEqual({
      path: actual,
      exists: true,
      source: 'filesystem',
    });
    expect(await resolveProjectPath(`-${encoded}`)).toEqual({
      path: actual,
      exists: true,
      source: 'filesystem',
    });
  });

  it('discovers only directory projects and top-level JSONL sessions', async () => {
    const root = await makeTempDir();
    const claudeDir = path.join(root, 'claude');
    const projectDir = path.join(claudeDir, 'projects', '-work-one');
    await mkdir(path.join(projectDir, 'memory'), { recursive: true });
    await writeFile(path.join(projectDir, 'abc.jsonl'), '{}\n');
    await writeFile(path.join(projectDir, 'notes.txt'), 'ignore');
    await writeFile(path.join(projectDir, 'memory', 'nested.jsonl'), '{}');
    await writeFile(
      path.join(claudeDir, 'projects', 'not-a-project.jsonl'),
      '{}',
    );

    const projects = await discoverProjects(claudeDir);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: '-work-one',
      dir: projectDir,
      hasMemory: true,
    });
    expect(projects[0]?.sessionFiles.map(({ sessionId }) => sessionId)).toEqual(
      ['abc'],
    );
  });

  it('discovers projects that are symlinks to directories', async () => {
    const root = await makeTempDir();
    const claudeDir = path.join(root, 'claude');
    const target = path.join(root, 'target-project');
    const projectsDir = path.join(claudeDir, 'projects');
    await mkdir(target, { recursive: true });
    await mkdir(projectsDir, { recursive: true });
    await writeFile(path.join(target, 'linked-session.jsonl'), '{}\n');
    await symlink(target, path.join(projectsDir, '-linked-project'), 'dir');

    const projects = await discoverProjects(claudeDir);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe('-linked-project');
    expect(projects[0]?.sessionFiles.map(({ sessionId }) => sessionId)).toEqual(
      ['linked-session'],
    );
  });

  it('reads the memory index and tolerates malformed frontmatter', async () => {
    const root = await makeTempDir();
    const memoryDir = path.join(root, 'memory');
    await mkdir(memoryDir);
    await writeFile(path.join(memoryDir, 'MEMORY.md'), '# Index');
    await writeFile(
      path.join(memoryDir, 'one.md'),
      '---\nname: One\ndescription: A note\nmetadata:\n  type: reference\n---\nBody',
    );
    await writeFile(
      path.join(memoryDir, 'broken.md'),
      '---\n[broken\n---\nKept body',
    );

    const result = await readProjectMemory(root);
    expect(result.index).toBe('# Index');
    expect(result.files.find(({ name }) => name === 'one.md')).toMatchObject({
      frontmatter: {
        name: 'One',
        description: 'A note',
        metadata: { type: 'reference' },
      },
      body: 'Body',
    });
    expect(result.files.find(({ name }) => name === 'broken.md')).toMatchObject(
      { frontmatter: {}, body: 'Kept body' },
    );
  });
});

it('ignores state folders exposed as project directories', async () => {
  const { mkdtemp, mkdir, symlink, writeFile, rm } =
    await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { vi } = await import('vitest');
  const home = await mkdtemp(join(tmpdir(), 'c9view-project-state-'));
  try {
    const claude = join(home, 'claude');
    await mkdir(join(claude, 'projects'), { recursive: true });
    for (const name of ['c9view', 'my-state']) {
      const state = join(claude, name);
      await mkdir(state);
      await writeFile(join(state, 'private.jsonl'), '{}');
      await symlink(state, join(claude, 'projects', name));
    }
    vi.stubEnv('HOME', home);
    vi.stubEnv('C9VIEW_STATE_DIR', join(claude, 'my-state'));
    expect(await discoverProjects(claude)).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }
});

import { isC9viewStatePath } from '../state/ignore.js';
import { hookStateDir } from '../hooks/state-dir.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export type ProjectPathSource = 'transcript' | 'filesystem' | 'decoded';

export interface ResolvedProjectPath {
  path: string;
  exists: boolean;
  source: ProjectPathSource;
}

export interface ProjectPathOptions {
  cwdHints?: string[];
}

export interface ProjectSessionFile {
  sessionId: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export interface DiscoveredProject {
  id: string;
  dir: string;
  sessionFiles: ProjectSessionFile[];
  hasMemory: boolean;
}

export interface MemoryFrontmatter {
  name?: string;
  description?: string;
  metadata?: { type?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ProjectMemoryFile {
  name: string;
  path: string;
  frontmatter: MemoryFrontmatter;
  body: string;
}

export interface ProjectMemory {
  index?: string;
  files: ProjectMemoryFile[];
}

/** Encode a path as a Claude project folder, preserving one dash per character. */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/[^A-Za-z0-9]/g, '-');
}

/** Decode the common Claude project-dir encoding, choosing slash for ambiguous dashes. */
export function decodeProjectDir(name: string): string {
  const normalized = name.replace(/--/g, '/.').replace(/-/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/** Generate plausible decodings, preferring slash/dot interpretations before literal hyphens. */
export function candidatePaths(name: string): string[] {
  return [decodeProjectDir(name)];
}

export async function resolveProjectPath(
  name: string,
  options: ProjectPathOptions = {},
): Promise<ResolvedProjectPath> {
  const hints = options.cwdHints ?? [];
  if (hints.length > 0) {
    const counts = new Map<string, number>();
    for (const hint of hints) {
      if (typeof hint === 'string' && path.isAbsolute(hint))
        counts.set(hint, (counts.get(hint) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const mostCommon =
      ranked.find(([hint]) => encodeProjectPath(hint) === name)?.[0] ??
      ranked[0]?.[0];
    if (mostCommon)
      return {
        path: mostCommon,
        exists: await isDirectory(mostCommon),
        source: 'transcript',
      };
  }

  const filesystemPath = await resolveEncodedPath(name);
  if (filesystemPath)
    return { path: filesystemPath, exists: true, source: 'filesystem' };
  return { path: decodeProjectDir(name), exists: false, source: 'decoded' };
}

async function resolveEncodedPath(name: string): Promise<string | null> {
  const encoded = name.startsWith('/')
    ? name.slice(1)
    : name.replace(/^-/u, '');
  const directoryEntries = new Map<string, Promise<string[]>>();
  const visited = new Set<string>();
  const maxDepth = 40;
  const maxStates = 100_000;

  const listDirectories = (directory: string): Promise<string[]> => {
    let cached = directoryEntries.get(directory);
    if (!cached) {
      cached = readdir(directory).catch(() => []);
      directoryEntries.set(directory, cached);
    }
    return cached;
  };

  const walk = async (
    directory: string,
    remaining: string,
    depth: number,
  ): Promise<string | null> => {
    if (!remaining) return directory;
    if (depth >= maxDepth || visited.size >= maxStates) return null;
    const state = `${directory}\0${remaining}`;
    if (visited.has(state)) return null;
    visited.add(state);

    const entries = await listDirectories(directory);
    const matches = entries
      .map((entry) => ({
        entry,
        encoded: encodeProjectPath(entry),
      }))
      .filter(
        ({ encoded }) =>
          encoded.length > 0 &&
          (remaining === encoded || remaining.startsWith(`${encoded}-`)),
      )
      .sort((a, b) => b.encoded.length - a.encoded.length);

    for (const { entry, encoded: segment } of matches) {
      const child = path.join(directory, entry);
      if (!(await isDirectory(child))) continue;
      if (remaining === segment) return child;
      const result = await walk(
        child,
        remaining.slice(segment.length + 1),
        depth + 1,
      );
      if (result) return result;
      if (visited.size >= maxStates) return null;
    }
    // Claude's `/.` path component contributes a second dash in the encoded
    // name but has no corresponding directory entry on disk.
    if (remaining.startsWith('-')) {
      return walk(directory, remaining.slice(1), depth + 1);
    }
    return null;
  };

  return walk(path.parse(path.resolve('/')).root, encoded, 0);
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export async function discoverProjects(
  claudeDir: string,
): Promise<DiscoveredProject[]> {
  const stateDir = hookStateDir();
  const projectsDir = path.join(claudeDir, 'projects');
  if (isC9viewStatePath(claudeDir, stateDir, projectsDir)) return [];
  let entries;
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects: DiscoveredProject[] = [];
  for (const entry of entries) {
    const dir = path.join(projectsDir, entry.name);
    if (isC9viewStatePath(claudeDir, stateDir, dir)) continue;
    if (
      !entry.isDirectory() &&
      !(entry.isSymbolicLink() && (await isDirectory(dir)))
    )
      continue;
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const sessionFiles: ProjectSessionFile[] = [];
    for (const child of children) {
      if (!child.isFile() || !child.name.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, child.name);
      if (isC9viewStatePath(claudeDir, stateDir, filePath)) continue;
      try {
        const info = await stat(filePath);
        sessionFiles.push({
          sessionId: child.name.slice(0, -'.jsonl'.length),
          path: filePath,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      } catch {
        // Files can disappear while the directory is being scanned.
      }
    }
    projects.push({
      id: entry.name,
      dir,
      sessionFiles,
      hasMemory: await isDirectory(path.join(dir, 'memory')),
    });
  }
  return projects;
}

function parseFrontmatter(contents: string): {
  frontmatter: MemoryFrontmatter;
  body: string;
} {
  const match = contents.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { frontmatter: {}, body: contents };
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? '');
  } catch {
    parsed = undefined;
  }
  const frontmatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as MemoryFrontmatter)
      : {};
  return { frontmatter, body: contents.slice(match[0].length) };
}

export async function readProjectMemory(
  projectDir: string,
): Promise<ProjectMemory> {
  const memoryDir = path.join(projectDir, 'memory');
  let entries;
  try {
    entries = await readdir(memoryDir, { withFileTypes: true });
  } catch {
    return { files: [] };
  }
  let index: string | undefined;
  const files: ProjectMemoryFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(memoryDir, entry.name);
    try {
      const contents = await readFile(filePath, 'utf8');
      if (entry.name.toLowerCase() === 'memory.md') {
        index = contents;
      } else {
        const parsed = parseFrontmatter(contents);
        files.push({ name: entry.name, path: filePath, ...parsed });
      }
    } catch {
      // Ignore files that become unreadable during a scan.
    }
  }
  const result: ProjectMemory = { files };
  if (index !== undefined) result.index = index;
  return result;
}

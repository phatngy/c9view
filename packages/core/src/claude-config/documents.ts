import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import {
  clean,
  entries,
  readText,
  readTextResult,
  type ReadPolicy,
  type JsonRecord,
  type Scope,
  type Source,
} from './shared.js';

export interface InstructionNode {
  path: string;
  content?: string;
  denied?: true;
  reason?: string;
  includes: InstructionNode[];
}
export interface Instruction extends InstructionNode {
  source: Source;
}

export async function readInstructions(
  claudeDir: string,
  projectPath?: string,
): Promise<Instruction[]> {
  const roots: [string, Scope][] = [[join(claudeDir, 'CLAUDE.md'), 'user']];
  if (projectPath)
    roots.push(
      [join(projectPath, 'CLAUDE.md'), 'project'],
      [join(projectPath, '.claude/CLAUDE.md'), 'project'],
      [join(projectPath, 'CLAUDE.local.md'), 'local'],
      [join(projectPath, 'AGENTS.md'), 'project'],
    );
  async function load(
    path: string,
    depth: number,
    ancestors: Set<string>,
    policy: ReadPolicy,
  ): Promise<InstructionNode | undefined> {
    const read = await readTextResult(path, policy);
    if (!read) return undefined;
    if (read.denied)
      return { path, denied: true, reason: read.reason, includes: [] };
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      return undefined;
    }
    if (ancestors.has(canonical)) return undefined;
    const content = read.content;
    const includes: InstructionNode[] = [];
    if (depth < 5) {
      const next = new Set([...ancestors, canonical]);
      for (const line of content.split(/\r?\n/)) {
        const match = /^\s*@(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*$/.exec(line);
        const reference = match?.[1] ?? match?.[2] ?? match?.[3];
        if (!reference) continue;
        const target = reference.startsWith('~/')
          ? join(homedir(), reference.slice(2))
          : resolve(dirname(path), reference);
        const included = await load(target, depth + 1, next, policy);
        if (included) includes.push(included);
      }
    }
    return { path, content, includes };
  }
  const result: Instruction[] = [];
  for (const [path, scope] of roots) {
    const node = await load(path, 0, new Set(), {
      roots: [
        claudeDir,
        ...(scope === 'user' ? [homedir()] : projectPath ? [projectPath] : []),
      ],
    });
    if (node) result.push({ ...node, source: { path, scope } });
  }
  return clean(result);
}

export interface ConfigDocument {
  name: string;
  description?: string;
  model?: string;
  tools?: unknown;
  frontmatter: JsonRecord;
  content: string;
  source: Source;
}
async function document(
  path: string,
  scope: Scope,
  fallback: string,
  policy?: ReadPolicy,
): Promise<ConfigDocument | undefined> {
  const text = await readText(path, policy);
  if (text === undefined) return undefined;
  const { frontmatter, content } = parseFrontmatter(text);
  return clean({
    name: typeof frontmatter.name === 'string' ? frontmatter.name : fallback,
    ...(typeof frontmatter.description === 'string'
      ? { description: frontmatter.description }
      : {}),
    ...(typeof frontmatter.model === 'string'
      ? { model: frontmatter.model }
      : {}),
    ...(frontmatter.tools !== undefined ? { tools: frontmatter.tools } : {}),
    frontmatter,
    content,
    source: { path, scope },
  });
}
export async function readSkills(
  dir: string,
  scope: Scope,
  policy: ReadPolicy = {
    roots: [dirname(dir), ...(scope === 'user' ? [homedir()] : [])],
  },
): Promise<ConfigDocument[]> {
  const result: ConfigDocument[] = [];
  async function visit(parent: string, depth: number): Promise<void> {
    for (const name of await entries(parent)) {
      const path = join(parent, name);
      const doc = await document(join(path, 'SKILL.md'), scope, name, policy);
      if (doc) result.push(doc);
      else if (depth < 2) await visit(path, depth + 1);
    }
  }
  await visit(dir, 1);
  return clean(result);
}
async function readMarkdown(
  dir: string,
  scope: Scope,
  policy: ReadPolicy = {
    roots: [dirname(dir), ...(scope === 'user' ? [homedir()] : [])],
  },
): Promise<ConfigDocument[]> {
  const result: ConfigDocument[] = [];
  for (const name of await entries(dir)) {
    if (!name.endsWith('.md') || name.endsWith('.bk.md')) continue;
    const doc = await document(
      join(dir, name),
      scope,
      name.slice(0, -3),
      policy,
    );
    if (doc) result.push(doc);
  }
  return clean(result);
}
export const readAgents = readMarkdown;
export const readCommands = readMarkdown;

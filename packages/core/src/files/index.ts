import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { extname, join, resolve, relative } from 'node:path';
import { redactText } from '../redact/index.js';
import { createGit } from '../git/index.js';
import { deniedPath, inside, isBinary, validateRelative } from './policy.js';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size?: number;
  mtimeMs?: number;
  denied?: boolean;
  reason?: string;
  ignored?: boolean;
  outside?: boolean;
}
export interface FileContent {
  path: string;
  size: number;
  language: string;
  binary: boolean;
  tooLarge: boolean;
  content?: string;
}
const languages: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  py: 'python',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  css: 'css',
  html: 'html',
  rs: 'rust',
  go: 'go',
};
export function createFileAccess({
  root,
  extraDeny = [],
}: {
  root: string;
  extraDeny?: readonly string[];
}) {
  async function resolveSafe(relPath: string): Promise<string> {
    validateRelative(relPath);
    if (deniedPath(relPath, extraDeny)) throw new Error('Sensitive path');
    const canonicalRoot = await realpath(root);
    const target = await realpath(resolve(canonicalRoot, relPath));
    if (!inside(canonicalRoot, target)) throw new Error('Outside project');
    if (deniedPath(relative(canonicalRoot, target), extraDeny))
      throw new Error('Sensitive path');
    return target;
  }
  async function listDir(relPath = ''): Promise<FileEntry[]> {
    const dir = await resolveSafe(relPath);
    const result: FileEntry[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.toLowerCase() === '.git' || entry.name === 'node_modules')
        continue;
      const path = join(relPath, entry.name);
      const item: FileEntry = {
        name: entry.name,
        path,
        type: entry.isSymbolicLink()
          ? 'symlink'
          : entry.isDirectory()
            ? 'dir'
            : entry.isFile()
              ? 'file'
              : 'other',
      };
      if (deniedPath(path, extraDeny)) {
        result.push({ ...item, denied: true, reason: 'sensitive path' });
        continue;
      }
      try {
        await resolveSafe(path);
        const info = await lstat(join(dir, entry.name));
        item.size = info.size;
        item.mtimeMs = info.mtimeMs;
      } catch (error) {
        if (item.type === 'symlink') {
          try {
            item.outside = !inside(
              await realpath(root),
              await realpath(join(dir, entry.name)),
            );
          } catch {
            item.outside = true;
          }
        }
        item.denied = true;
        item.reason =
          error instanceof Error && error.message === 'Sensitive path'
            ? 'sensitive path'
            : 'unavailable or outside project';
      }
      result.push(item);
    }
    const git = createGit(root);
    if (await git.isRepo()) {
      const ignored = await git.checkIgnore(result.map((e) => e.path));
      for (const item of result)
        if (ignored.has(item.path)) item.ignored = true;
    }
    return result.sort(
      (a, b) =>
        Number(b.type === 'dir') - Number(a.type === 'dir') ||
        a.name.localeCompare(b.name),
    );
  }
  async function readFile(
    relPath: string,
    { maxBytes = 1_000_000 }: { maxBytes?: number } = {},
  ): Promise<FileContent> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new Error('Invalid size limit');
    const path = await resolveSafe(relPath);
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      // O_NOFOLLOW protects the final component. Revalidate the opened descriptor
      // too, so swapping an ancestor directory for a symlink cannot escape.
      // Linux resolves the descriptor through procfs; other platforms resolve
      // the path after open and compare lstat dev/ino to fstat before reading.
      const canonical = await realpath(
        process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : path,
      );
      const canonicalRoot = await realpath(root);
      if (
        !inside(canonicalRoot, canonical) ||
        deniedPath(relative(canonicalRoot, canonical), extraDeny)
      )
        throw new Error('Unsafe opened path');
      const current = await lstat(canonical);
      if (current.ino !== info.ino || current.dev !== info.dev)
        throw new Error('File changed during access');
      if (!info.isFile()) throw new Error('Not a regular file');
      const sample = Buffer.alloc(Math.min(8192, info.size));
      await handle.read(sample, 0, sample.length, 0);
      const binary = isBinary(sample);
      const tooLarge = info.size > Math.max(0, Math.min(maxBytes, 2_000_000));
      const language = languages[extname(relPath).slice(1)] ?? 'text';
      const result: FileContent = {
        path: relPath,
        size: info.size,
        language,
        binary,
        tooLarge,
      };
      if (!binary && !tooLarge) {
        // Bounded positional read also handles a file growing after stat.
        const buffer = Buffer.alloc(Math.min(maxBytes, 2_000_000) + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > Math.min(maxBytes, 2_000_000)) result.tooLarge = true;
        else
          result.content = redactText(
            buffer.subarray(0, bytesRead).toString('utf8'),
          );
      }
      return result;
    } finally {
      await handle.close();
    }
  }
  return { resolveSafe, listDir, readFile };
}

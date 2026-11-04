import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  mergeSettings,
  readSettings,
  readHooks,
  readMcpServers,
  readPlugins,
} from '@c9view/core';
import { z } from 'zod';
import type { TrustSummary } from '@c9view/api';
import { redactStrings } from '../data/redaction.js';
import type { TrustState } from './state.js';
import { ControlError } from './errors.js';
const record = z.record(z.string(), z.unknown());
export class FolderTrust {
  constructor(
    private claudeDir: string,
    private state: TrustState,
  ) {}
  async summary(folder: string): Promise<TrustSummary> {
    folder = await realpath(folder);
    const settings = mergeSettings(await readSettings(this.claudeDir, folder));
    const enabled = record.safeParse(settings.effective.enabledPlugins);
    const enabledIds = enabled.success
      ? Object.entries(enabled.data)
          .filter(([, value]) => value === true)
          .map(([id]) => id)
      : [];
    const plugins = (await readPlugins(this.claudeDir)).plugins.filter(
      (plugin) => enabledIds.includes(plugin.id),
    );
    const sources = [
      join(folder, '.claude/settings.json'),
      join(folder, '.claude/settings.local.json'),
      join(folder, '.mcp.json'),
      join(folder, 'CLAUDE.md'),
      join(this.claudeDir, 'settings.json'),
      join(this.claudeDir, 'settings.local.json'),
      join(this.claudeDir, 'plugins/installed_plugins.json'),
      join(this.claudeDir, 'plugins/known_marketplaces.json'),
      join(dirname(resolve(this.claudeDir)), '.claude.json'),
      ...plugins.flatMap((plugin) =>
        plugin.installPath
          ? [
              'hooks/hooks.json',
              'plugin.json',
              '.claude-plugin/plugin.json',
              '.mcp.json',
            ].map((file) => join(plugin.installPath!, file))
          : [],
      ),
      ...plugins.flatMap((plugin) => [
        ...plugin.hooks.map((hook) => hook.source.path),
        ...plugin.mcpServers.map((server) => server.source.path),
      ]),
    ];
    const hash = createHash('sha256');
    for (const file of [...new Set(sources)].sort()) {
      hash.update(file);
      try {
        const [info, bytes] = await Promise.all([stat(file), readFile(file)]);
        hash
          .update(`${info.size}:`)
          .update(createHash('sha256').update(bytes).digest());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new ControlError(
            409,
            'Cannot read folder settings safely',
            'untrusted-folder',
          );
        hash.update('missing');
      }
    }
    const permissions = record.safeParse(settings.effective.permissions);
    const allow =
      permissions.success && Array.isArray(permissions.data.allow)
        ? permissions.data.allow.filter(
            (v): v is string => typeof v === 'string',
          )
        : [];
    const summary = {
      path: folder,
      hooks: [
        ...readHooks(settings),
        ...plugins.flatMap((plugin) => plugin.hooks),
      ].map((hook) => hook.command ?? hook.url ?? hook.type),
      mcpServers: [
        ...(await readMcpServers(this.claudeDir, folder)),
        ...plugins.flatMap((plugin) => plugin.mcpServers),
      ].map(
        (server) =>
          `${server.name}: ${server.command ?? server.url ?? server.type ?? ''}`,
      ),
      allowRules: allow,
      plugins: enabledIds,
      hasClaudeMd: await stat(join(folder, 'CLAUDE.md')).then(
        (s) => s.isFile(),
        () => false,
      ),
    };
    return redactStrings({
      ...summary,
      fingerprint: hash.update(JSON.stringify(summary)).digest('hex'),
    });
  }
  async check(folder: string) {
    folder = await realpath(folder);
    const summary = await this.summary(folder);
    let claudeTrusted = false;
    try {
      const schema = z
        .object({
          projects: z
            .record(
              z.string(),
              z
                .object({ hasTrustDialogAccepted: z.boolean().optional() })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough();
      const data = schema.parse(
        JSON.parse(
          await readFile(
            join(dirname(resolve(this.claudeDir)), '.claude.json'),
            'utf8',
          ),
        ),
      );
      claudeTrusted = data.projects?.[folder]?.hasTrustDialogAccepted === true;
    } catch {
      /* Missing or malformed trust is never consent. */
    }
    if (!claudeTrusted && !this.state.trusted(folder, summary.fingerprint))
      throw new ControlError(
        409,
        'Trust this folder before running Claude Code',
        'untrusted-folder',
        summary,
      );
    return summary;
  }
  async accept(folder: string, fingerprint: string, knownFolders: string[]) {
    // The path from the browser is an identifier for a known project, not a new working directory.
    try {
      folder = await realpath(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ControlError(404, 'Not found');
      throw error;
    }
    const known = await Promise.all(knownFolders.map((path) => realpath(path)));
    if (!known.includes(folder)) throw new ControlError(404, 'Not found');
    const summary = await this.summary(folder);
    if (summary.fingerprint !== fingerprint)
      throw new ControlError(
        409,
        'Folder settings changed; review them again',
        'settings-changed',
        summary,
      );
    this.state.trust(folder, fingerprint);
  }
}
/** State must not escape its dedicated exception into a project or Claude data. */
export function assertStateLocation(
  stateDir: string,
  claudeDir: string,
  folders: string[],
) {
  const canonical = (value: string): string => {
    let path = resolve(value);
    const tail: string[] = [];
    for (;;) {
      try {
        return join(realpathSync(path), ...tail);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = dirname(path);
        if (parent === path) throw error;
        tail.unshift(basename(path));
        path = parent;
      }
    }
  };
  stateDir = canonical(stateDir);
  claudeDir = canonical(claudeDir);
  folders = folders.map(canonical);
  const inside = (parent: string, child: string) => {
    const rel = relative(resolve(parent), resolve(child));
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
  };
  if (
    (inside(claudeDir, stateDir) &&
      !inside(join(claudeDir, 'c9view'), stateDir)) ||
    folders.some((folder) => inside(folder, stateDir))
  )
    throw new Error(
      'C9VIEW_STATE_DIR must be outside projects and Claude data except its c9view folder',
    );
}

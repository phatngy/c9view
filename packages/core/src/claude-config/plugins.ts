import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  readAgents,
  readCommands,
  readSkills,
  type ConfigDocument,
} from './documents.js';
import { mcpServersFromData, type McpServer } from './mcp.js';
import { readHooks, type Hook } from './hooks.js';
import { mergeSettings, readSettings } from './settings.js';
import {
  clean,
  entries,
  readJson,
  record,
  type JsonRecord,
  type Source,
  type ReadPolicy,
} from './shared.js';

export interface Plugin {
  id: string;
  source: Source;
  installPath?: string;
  enabled?: boolean;
  metadata: JsonRecord;
  skills: ConfigDocument[];
  agents: ConfigDocument[];
  commands: ConfigDocument[];
  hooks: Hook[];
  mcpServers: McpServer[];
}
export interface PluginInventory {
  plugins: Plugin[];
  marketplaces: { name: string; data: JsonRecord; source: Source }[];
  enabledPlugins: JsonRecord;
}
export async function readPlugins(claudeDir: string): Promise<PluginInventory> {
  const policy: ReadPolicy = { roots: [claudeDir] };
  const registryPath = join(claudeDir, 'plugins/installed_plugins.json');
  const marketplacePath = join(claudeDir, 'plugins/known_marketplaces.json');
  const installed = await readJson(registryPath, policy);
  const known = await readJson(marketplacePath, policy);
  const enabledPlugins = record(
    mergeSettings(await readSettings(claudeDir)).effective.enabledPlugins,
  );
  const plugins: Plugin[] = [];
  for (const [id, records] of Object.entries(record(installed?.plugins))) {
    for (const raw of Array.isArray(records) ? records : [records]) {
      const metadata = record(raw);
      const source: Source = { scope: 'plugin', path: registryPath };
      const plugin: Plugin = {
        id,
        source,
        metadata,
        skills: [],
        agents: [],
        commands: [],
        hooks: [],
        mcpServers: [],
        ...(typeof enabledPlugins[id] === 'boolean'
          ? { enabled: enabledPlugins[id] }
          : {}),
      };
      const path = await pluginPath(claudeDir, id, metadata.installPath);
      if (path) {
        plugin.installPath = path;
        plugin.source = { scope: 'plugin', path };
        plugin.skills = await readSkills(
          join(path, 'skills'),
          'plugin',
          policy,
        );
        plugin.agents = await readAgents(
          join(path, 'agents'),
          'plugin',
          policy,
        );
        plugin.commands = await readCommands(
          join(path, 'commands'),
          'plugin',
          policy,
        );
        // Read both manifest locations: distributions differ, and either may add hooks.
        for (const relativePath of [
          'hooks/hooks.json',
          'plugin.json',
          '.claude-plugin/plugin.json',
        ]) {
          const hookPath = join(path, relativePath);
          const manifest = await readJson(hookPath, policy);
          if (!manifest) continue;
          const hookInputs = Array.isArray(manifest.hooks)
            ? manifest.hooks
            : [manifest.hooks];
          for (const input of hookInputs) {
            if (typeof input === 'string') {
              const referenced = join(
                path,
                input.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, ''),
              );
              const data = await readJson(referenced, policy);
              if (data)
                plugin.hooks.push(
                  ...readHooks(data, { scope: 'plugin', path: referenced }),
                );
            } else
              plugin.hooks.push(
                ...readHooks(
                  { hooks: input },
                  { scope: 'plugin', path: hookPath },
                ),
              );
          }
          if (relativePath !== 'hooks/hooks.json')
            plugin.mcpServers.push(
              ...mcpServersFromData(manifest, {
                scope: 'plugin',
                path: hookPath,
              }),
            );
        }
        const mcpPath = join(path, '.mcp.json');
        const mcp = await readJson(mcpPath, policy);
        if (mcp)
          plugin.mcpServers.push(
            ...mcpServersFromData(mcp, { scope: 'plugin', path: mcpPath }),
          );
        plugin.hooks = plugin.hooks.filter(
          (hook, index, all) =>
            all.findIndex(
              (other) => JSON.stringify(other) === JSON.stringify(hook),
            ) === index,
        );
      }
      plugins.push(plugin);
    }
  }
  return clean({
    plugins,
    enabledPlugins,
    marketplaces: Object.entries(known ?? {}).map(([name, data]) => ({
      name,
      data: record(data),
      source: { scope: 'plugin' as const, path: marketplacePath },
    })),
  });
}

async function directory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
function semver(version: string): number[] | undefined {
  const match =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      version,
    );
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}
function compareVersions(a: string, b: string): number {
  const av = semver(a)!;
  const bv = semver(b)!;
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i]! - bv[i]!;
  const pre = (v: string): string | undefined =>
    /^v?\d+\.\d+\.\d+-([^+]+)/.exec(v)?.[1];
  const ap = pre(a);
  const bp = pre(b);
  if (!ap || !bp) return ap ? -1 : bp ? 1 : 0;
  const as = ap.split('.');
  const bs = bp.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i];
    const y = bs[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
async function pluginPath(
  claudeDir: string,
  id: string,
  installed: unknown,
): Promise<string | undefined> {
  if (typeof installed === 'string') {
    const path = resolve(claudeDir, 'plugins', installed);
    if (await directory(path)) return path;
  }
  const match = /^([^@/\\]+)@([^@/\\]+)$/.exec(id);
  if (
    !match ||
    [match[1], match[2]].some((part) => part === '.' || part === '..')
  )
    return undefined;
  const base = join(claudeDir, 'plugins/cache', match[2]!, match[1]!);
  const candidates = [];
  for (const name of await entries(base)) {
    const path = join(base, name);
    const rel = relative(base, path);
    if (isAbsolute(rel) || rel.startsWith('..')) continue;
    try {
      const info = await stat(path);
      if (info.isDirectory())
        candidates.push({ name, path, mtime: info.mtimeMs });
    } catch {
      /* stale cache entry */
    }
  }
  const versions = candidates.filter((entry) => semver(entry.name));
  if (versions.length)
    return versions.sort((a, b) => compareVersions(b.name, a.name))[0]?.path;
  return candidates.sort(
    (a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name),
  )[0]?.path;
}

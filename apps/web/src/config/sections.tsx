import type { GlobalConfigResponse, ProjectDetailResponse } from '@c9view/api';

export type Config = ProjectDetailResponse['config'] | GlobalConfigResponse;
export interface ConfigRowData {
  name: string;
  scope: string;
  description: string;
  path?: string;
  markdown?: string;
}
export interface ConfigSection {
  id: string;
  title: string;
  rows: ConfigRowData[];
}

export function configSections(config: Config): ConfigSection[] {
  const global = 'plugins' in config;
  const scope = global ? 'user' : 'project';
  return [
    ...(['skills', 'agents', 'commands'] as const).map((id) => ({
      id,
      title: id[0]!.toUpperCase() + id.slice(1),
      rows: config[id].map((item) => ({
        ...item,
        description: item.description ?? 'No description provided.',
      })),
    })),
    {
      id: 'hooks',
      title: 'Hooks',
      rows: config.hooks.map((hook) => ({
        name: hook.event,
        scope: hook.scope,
        description:
          [hook.matcher && `Matcher: ${hook.matcher}`, hook.command]
            .filter(Boolean)
            .join(' · ') || 'No command.',
      })),
    },
    {
      id: 'mcp',
      title: 'MCP',
      rows: config.mcpServers.map((server) => ({
        ...server,
        description: server.transport,
      })),
    },
    {
      id: 'instructions',
      title: 'Instructions',
      rows: config.instructions.map((item) => ({
        name: item.path.split('/').pop() || item.path,
        scope,
        path: item.path,
        description:
          item.content.replace(/\s+/g, ' ').trim() || 'Empty instruction file.',
        markdown: item.content,
      })),
    },
    {
      id: 'memory',
      title: 'Memory',
      rows:
        'memory' in config
          ? config.memory.map((item) => ({
              name: item.name,
              scope,
              description: item.description ?? item.type ?? 'Memory file',
              markdown: item.body,
            }))
          : [],
    },
    {
      id: 'plugins',
      title: 'Plugins',
      rows: global
        ? config.plugins.map((plugin) => ({
            name: plugin.id,
            scope: 'plugin',
            description: `${plugin.enabled ? 'Enabled' : 'Disabled'}${plugin.version ? ` · ${plugin.version}` : ''} · ${plugin.skills} skills · ${plugin.agents} agents · ${plugin.commands} commands`,
          }))
        : [],
    },
    {
      id: 'settings',
      title: 'Settings',
      rows: Object.entries(config.settings).map(([name, value]) => ({
        name,
        scope:
          'provenance' in config
            ? (config.provenance[
                `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`
              ] ?? scope)
            : scope,
        description: JSON.stringify(value) ?? String(value),
      })),
    },
  ];
}

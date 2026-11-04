import { join } from 'node:path';
import {
  redactValue,
  readSettings,
  mergeSettings,
  readInstructions,
  readSkills,
  readAgents,
  readCommands,
  readPlugins,
  readMcpServers,
  readHooks,
  readProjectMemory,
  type ConfigDocument,
  type InstructionNode,
} from '@c9view/core';
import type {
  ConfigItem,
  GlobalConfigResponse,
  ProjectDetailResponse,
} from '@c9view/api';

const item = (doc: ConfigDocument): ConfigItem => ({
  name: doc.name,
  description: doc.description ?? null,
  scope: doc.source.scope,
  path: doc.source.path,
});
function instructions(
  nodes: InstructionNode[],
): { path: string; content: string }[] {
  return nodes.flatMap((node) => [
    ...(node.content === undefined
      ? []
      : [{ path: node.path, content: node.content }]),
    ...instructions(node.includes),
  ]);
}
export async function readConfig(
  claudeDir: string,
  projectPath?: string,
): Promise<GlobalConfigResponse> {
  const [layers, docs, servers, inventory] = await Promise.all([
    readSettings(claudeDir, projectPath),
    readInstructions(claudeDir, projectPath),
    readMcpServers(claudeDir, projectPath),
    readPlugins(claudeDir),
  ]);
  const merged = mergeSettings(layers);
  const locations = [
    { dir: claudeDir, scope: 'user' as const },
    ...(projectPath
      ? [{ dir: join(projectPath, '.claude'), scope: 'project' as const }]
      : []),
  ];
  const lists = await Promise.all(
    locations.map(async ({ dir, scope }) => {
      const [skills, agents, commands] = await Promise.all([
        readSkills(join(dir, 'skills'), scope),
        readAgents(join(dir, 'agents'), scope),
        readCommands(join(dir, 'commands'), scope),
      ]);
      return { skills, agents, commands };
    }),
  );
  const enabled = inventory.plugins.filter((p) => p.enabled !== false);
  const hooks = [...readHooks(merged), ...enabled.flatMap((p) => p.hooks)];
  return {
    settings: redactValue(merged.effective) as Record<string, unknown>,
    provenance: merged.provenance,
    hooks: hooks.map((h) => ({
      event: h.event,
      matcher: h.matcher ?? null,
      command: h.command ?? h.url ?? '',
      scope: h.source.scope,
    })),
    skills: [
      ...lists.flatMap((l) => l.skills),
      ...enabled.flatMap((p) => p.skills),
    ].map(item),
    agents: [
      ...lists.flatMap((l) => l.agents),
      ...enabled.flatMap((p) => p.agents),
    ].map(item),
    commands: [
      ...lists.flatMap((l) => l.commands),
      ...enabled.flatMap((p) => p.commands),
    ].map(item),
    plugins: inventory.plugins.map((p) => ({
      id: p.id,
      enabled: p.enabled ?? true,
      version:
        typeof p.metadata.version === 'string' ? p.metadata.version : null,
      skills: p.skills.length,
      agents: p.agents.length,
      commands: p.commands.length,
    })),
    mcpServers: [...servers, ...enabled.flatMap((p) => p.mcpServers)].map(
      (s) => ({
        name: s.name,
        transport: s.transport ?? s.type ?? (s.url ? 'http' : 'stdio'),
        scope: s.source.scope,
      }),
    ),
    instructions: instructions(docs),
  };
}
export async function projectConfig(
  claudeDir: string,
  projectPath: string,
  projectDir: string,
): Promise<ProjectDetailResponse['config']> {
  const [config, memory] = await Promise.all([
    readConfig(claudeDir, projectPath),
    readProjectMemory(projectDir),
  ]);
  return {
    skills: config.skills,
    agents: config.agents,
    commands: config.commands,
    hooks: config.hooks,
    mcpServers: config.mcpServers,
    instructions: config.instructions,
    settings: config.settings,
    memory: [
      ...(memory.index === undefined
        ? []
        : [
            {
              name: 'MEMORY.md',
              description: null,
              type: null,
              body: memory.index,
            },
          ]),
      ...memory.files.map((f) => ({
        name:
          typeof f.frontmatter.name === 'string' ? f.frontmatter.name : f.name,
        description:
          typeof f.frontmatter.description === 'string'
            ? f.frontmatter.description
            : null,
        type:
          typeof f.frontmatter.type === 'string'
            ? f.frontmatter.type
            : typeof f.frontmatter.metadata?.type === 'string'
              ? f.frontmatter.metadata.type
              : null,
        body: f.body,
      })),
    ],
  };
}

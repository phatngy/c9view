import { redactText } from '../redact/index.js';
import { dirname, join, resolve } from 'node:path';
import {
  clean,
  readJson,
  record,
  type JsonRecord,
  type Source,
  type ReadPolicy,
} from './shared.js';
import { readSettings } from './settings.js';

export interface McpServer {
  name: string;
  type?: string;
  transport?: string;
  command?: string;
  url?: string;
  args?: string;
  env?: string;
  headers?: string;
  source: Source;
}
export async function readMcpServers(
  claudeDir: string,
  projectPath?: string,
): Promise<McpServer[]> {
  const inputs: { data: JsonRecord; source: Source }[] = [];
  const globalPath = join(dirname(resolve(claudeDir)), '.claude.json');
  const policy: ReadPolicy = {
    roots: [claudeDir, ...(projectPath ? [projectPath] : [])],
  };
  const global = await readJson(globalPath, {
    roots: [dirname(globalPath)],
    globalMcpPath: globalPath,
  });
  if (global) {
    inputs.push({ data: global, source: { scope: 'user', path: globalPath } });
    if (projectPath)
      inputs.push({
        data: record(
          record(global.projects)[projectPath] ??
            record(global.projects)[resolve(projectPath)],
        ),
        source: { scope: 'project', path: globalPath },
      });
  }
  inputs.push(...(await readSettings(claudeDir, projectPath)));
  if (projectPath) {
    const path = join(projectPath, '.mcp.json');
    const data = await readJson(path, policy);
    if (data) inputs.push({ data, source: { scope: 'project', path } });
  }
  return clean(
    inputs.flatMap(({ data, source }) => mcpServersFromData(data, source)),
  );
}

/** Shared sanitizer for global, project and plugin MCP definitions. */
export function mcpServersFromData(
  data: JsonRecord,
  source: Source,
): McpServer[] {
  const result: McpServer[] = [];
  for (const [name, raw] of Object.entries(record(data.mcpServers))) {
    const server = record(raw);
    const output: McpServer = { name, source };
    for (const key of ['type', 'transport', 'command', 'url'] as const) {
      if (typeof server[key] === 'string')
        output[key] = redactText(server[key]);
    }
    for (const key of ['args', 'env', 'headers'] as const) {
      if (server[key] !== undefined) output[key] = `«redacted:${key}»`;
    }
    result.push(output);
  }
  return clean(result);
}

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readTranscript } from './reader.js';
import { isAssistantRecord, isUserRecord } from './schemas.js';

export interface SubagentTranscript {
  agentId: string;
  path: string;
  parentToolUseId?: string;
  description?: string;
}

/** Observed locally: subagents/agent-<agentId>.jsonl, with agentId on child
 * records. parentUuid is the child's conversation chain, not the Task/Agent
 * tool ID. The parent user record's toolUseResult.agentId matches the filename;
 * its message.content tool_result.tool_use_id references the parent Task/Agent
 * tool_use.id. description lives on toolUseResult or the tool_use input.
 * Unfinished agents may have no parent result yet, so their link is optional.
 */
export async function listSubagents(
  projectDir: string,
  sessionId: string,
): Promise<SubagentTranscript[]> {
  // These identifiers form paths, so reject traversal without assuming UUID IDs.
  if (
    !sessionId ||
    /[/\\]/u.test(sessionId) ||
    sessionId === '.' ||
    sessionId === '..'
  )
    throw new RangeError('sessionId must be a single path component');
  const directory = join(projectDir, sessionId, 'subagents');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const agents: SubagentTranscript[] = entries
    .filter((entry) => entry.isFile() && /^agent-.+\.jsonl$/u.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      agentId: entry.name.slice(6, -6),
      path: join(directory, entry.name),
    }));
  if (!agents.length) return agents;
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  const descriptions = new Map<string, string>();
  try {
    for await (const { record } of readTranscript(
      join(projectDir, `${sessionId}.jsonl`),
    )) {
      if (isAssistantRecord(record)) {
        for (const block of record.message.content) {
          if (
            block.type !== 'tool_use' ||
            !['Task', 'Agent'].includes(String(block.name)) ||
            typeof block.id !== 'string'
          )
            continue;
          const input = block.input;
          if (
            input &&
            typeof input === 'object' &&
            'description' in input &&
            typeof input.description === 'string'
          )
            descriptions.set(block.id, input.description);
        }
      }
      if (!isUserRecord(record)) continue;
      const result = record.toolUseResult;
      if (
        !result ||
        typeof result !== 'object' ||
        !('agentId' in result) ||
        typeof result.agentId !== 'string'
      )
        continue;
      const agent = byId.get(result.agentId);
      if (!agent) continue;
      if ('description' in result && typeof result.description === 'string')
        agent.description = result.description;
      if (Array.isArray(record.message.content)) {
        const blocks = record.message.content.filter(
          (block) =>
            block.type === 'tool_result' &&
            typeof block.tool_use_id === 'string',
        );
        // toolUseResult describes a single result. Never guess among parallel results.
        if (blocks.length === 1)
          agent.parentToolUseId = blocks[0]!.tool_use_id as string;
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  for (const agent of agents) {
    const description = agent.parentToolUseId
      ? descriptions.get(agent.parentToolUseId)
      : undefined;
    if (!agent.description && description !== undefined)
      agent.description = description;
  }
  return agents;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

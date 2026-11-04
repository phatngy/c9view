import type { RunMode } from '@c9view/api';
// This adapter deliberately defines its own narrow boundary: no other module
// imports the SDK, including for types.
export type ToolResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string };
export type CanUseTool = (
  tool: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => Promise<ToolResult>;
export interface UserInput {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}
export interface RunnerOptions {
  cwd: string;
  sessionId?: string;
  resume?: string;
  forkSession?: boolean;
  permissionMode: RunMode;
  env: NodeJS.ProcessEnv;
  pathToClaudeCodeExecutable: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  extraArgs?: Record<string, string>;
  canUseTool: CanUseTool;
  abortController: AbortController;
}
export interface RunnerMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  total_cost_usd?: number;
  is_error?: boolean;
}
export interface Runner extends AsyncIterable<RunnerMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: RunMode): Promise<void>;
  close(): void;
}
export type SdkAdapter = (
  prompt: AsyncIterable<UserInput>,
  options: RunnerOptions,
) => Promise<Runner>;
export const sdkAdapter: SdkAdapter = async (prompt, options) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return query({
    prompt,
    options: {
      ...options,
      settingSources: ['user', 'project', 'local'],
      allowDangerouslySkipPermissions:
        options.permissionMode === 'bypassPermissions',
    },
  });
};

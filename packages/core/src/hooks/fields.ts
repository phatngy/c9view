export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PostToolBatch',
  'PermissionDenied',
  'StopFailure',
  'PreCompact',
  'SessionEnd',
] as const;

/** Validate only bounded metadata; discard all payloads and unknown fields. */
export function whitelistHookInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid hook');
  const data = input as Record<string, unknown>;
  const field = (
    key: string,
    max: number,
    required = false,
  ): string | undefined => {
    const value = data[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || value.length > max)
      throw new Error('Invalid field');
    return value;
  };
  if (
    !HOOK_EVENTS.includes(data.hook_event_name as (typeof HOOK_EVENTS)[number])
  )
    throw new Error('Invalid event');
  return {
    hook_event_name: data.hook_event_name as (typeof HOOK_EVENTS)[number],
    session_id: field('session_id', 256, true)!,
    cwd: field('cwd', 1024, true)!,
    tool_name: field('tool_name', 256),
    notification_type: field('notification_type', 100),
    permission_mode: field('permission_mode', 100),
    agent_id: field('agent_id', 256),
    message: field('message', 65536),
  };
}

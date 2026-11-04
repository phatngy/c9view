// HTTP API contract shared by @c9view/hub and @c9view/web.
// All routes are GET, JSON, under /api. Times are ISO-8601 strings. Token counts are integers.
// Costs are API-equivalent USD estimates, not actual billing.

export type KanbanColumn = 'in_progress' | 'need_input' | 'in_review' | 'inactive';

export const KANBAN_COLUMNS: readonly KanbanColumn[] = [
  'inactive',
  'need_input',
  'in_progress',
  'in_review',
];

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  thinking: number;
}

export interface SessionStatus {
  column: KanbanColumn;
  /** Human-readable reason, e.g. "live status: busy · 12s ago". */
  reason: string;
  /** Which signal decided the column. */
  source: 'live-status' | 'transcript' | 'none' | 'hook';
  confidence?: 'high' | 'medium' | 'low';
  evidence?: { source: 'live-status' | 'transcript' | 'none' | 'hook'; at: string | null; detail: string }[];
  observedAt: string | null;
  stale: boolean;
}

// GET /api/health
export interface HealthResponse {
  ok: true;
  version: string;
  claudeDir: string;
  hooks?: { installed: boolean; eventsFile: string | null; lastEventAt: string | null };
}

// GET /api/overview
export interface OverviewResponse {
  projectCount: number;
  sessionCount: number;
  liveSessionCount: number;
  columns: Record<KanbanColumn, number>;
  tokens: TokenTotals;
  costUsd: number;
  /** From stats-cache.json, null if missing. */
  daily: { date: string; messages: number; sessions: number; toolCalls: number }[] | null;
  byModel: { model: string; tokens: TokenTotals; costUsd: number }[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  pathExists: boolean;
  sessionCount: number;
  lastActivityAt: string | null;
  columns: Record<KanbanColumn, number>;
  tokens: TokenTotals;
  costUsd: number;
}

// GET /api/projects
export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  firstAt: string | null;
  lastAt: string | null;
  gitBranch: string | null;
  models: string[];
  messageCount: number;
  lastMessagePreview: string | null;
  subagentCount: number;
  tokens: TokenTotals;
  costUsd: number;
  ownTokens?: TokenTotals;
  ownCostUsd?: number;
  subagentCostUsd?: number;
  status: SessionStatus;
  /** Live process name from sessions/<pid>.json, if running. */
  liveName: string | null;
}

export interface ConfigItem {
  name: string;
  description: string | null;
  scope: 'user' | 'project' | 'local' | 'plugin';
  path: string;
}

// GET /api/projects/:projectId
export interface ProjectDetailResponse {
  project: ProjectSummary;
  sessions: SessionSummary[];
  config: {
    skills: ConfigItem[];
    agents: ConfigItem[];
    commands: ConfigItem[];
    hooks: { event: string; matcher: string | null; command: string; scope: string }[];
    mcpServers: { name: string; transport: string; scope: string }[];
    instructions: { path: string; content: string }[];
    memory: { name: string; description: string | null; type: string | null; body: string }[];
    /** Effective merged settings (redacted). */
    settings: Record<string, unknown>;
  };
}

export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; change?: InlineChange }
  | { type: 'tool_result'; toolUseId: string; isError: boolean; text: string }
  | { type: 'image' };

export interface Message {
  uuid: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string | null;
  model: string | null;
  isMeta: boolean;
  isSidechain: boolean;
  blocks: MessageBlock[];
  usage: TokenTotals | null;
}

// GET /api/projects/:projectId/sessions/:sessionId?cursor=<n>&limit=<n>
//   or ?from=end&limit=<n> (the newest `limit` messages)
export interface SessionDetailResponse {
  session: SessionSummary;
  cwd: string | null;
  version: string | null;
  permissionModes: string[];
  toolUseCounts: Record<string, number>;
  errorCount: number;
  byModel: { model: string; tokens: TokenTotals; costUsd: number }[];
  subagents: { agentId: string; description: string | null; parentToolUseId: string | null }[];
  /** All text is redacted. Paged: messages[cursor .. cursor+limit). */
  messages: Message[];
  /** Absolute offset of this page's first message (clamped to totalMessages). */
  cursor: number;
  /** Start of the preceding page of `limit` messages; null when cursor is 0. */
  prevCursor: number | null;
  nextCursor: number | null;
  totalMessages: number;
}

// GET /api/projects/:projectId/sessions/:sessionId/status  (cheap, for polling)
export interface SessionPollResponse {
  status: SessionStatus;
  totalMessages: number;
  lastAt: string | null;
}

// GET /api/config  (global Claude Code config, redacted)
export interface GlobalConfigResponse {
  settings: Record<string, unknown>;
  provenance: Record<string, string>;
  hooks: ProjectDetailResponse['config']['hooks'];
  skills: ConfigItem[];
  agents: ConfigItem[];
  commands: ConfigItem[];
  plugins: { id: string; enabled: boolean; version: string | null; skills: number; agents: number; commands: number }[];
  mcpServers: ProjectDetailResponse['config']['mcpServers'];
  instructions: { path: string; content: string }[];
}

export interface ApiError {
  error: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}
export interface InlineChange {
  filePath: string;
  kind: 'create' | 'update';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  truncated: boolean;
}
export interface ProjectFileEntry {
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
export interface FileListResponse { path: string; entries: ProjectFileEntry[] }
export interface FileContentResponse {
  path: string;
  size: number;
  language: string;
  binary: boolean;
  tooLarge: boolean;
  content?: string;
}
export type GitStatusResponse = { isRepo: false } | {
  isRepo: true;
  branch: string;
  ahead: number;
  behind: number;
  files: { path: string; index: string; worktree: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' }[];
};
export interface GitDiffResponse {
  isRepo: boolean;
  files: { oldPath: string; path: string; hunks: DiffHunk[] }[];
}
export interface ToolFileChange {
  toolUseId: string;
  messageUuid: string;
  timestamp: string | null;
  tool: string;
  filePath: string;
  kind: 'create' | 'update';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  source: 'structuredPatch' | 'computed';
  userModified: boolean;
  tooLarge?: boolean;
}
export interface SessionChangedFile {
  fileId: string;
  filePath: string;
  relPath: string;
  kind: 'create' | 'update';
  /** Sum of returned step counts; the file diff endpoint supplies net counts. */
  additions: number;
  deletions: number;
  toolUseIds: string[];
  firstAt: string | null;
  lastAt: string | null;
}
export interface SessionChangesResponse { files: SessionChangedFile[]; truncated?: boolean }
export interface SessionFileDiffResponse {
  fileId: string;
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  source: 'file-history' | 'tool-hunks';
  steps: ToolFileChange[];
  tooLarge: boolean;
  partial: boolean;
  truncated?: boolean;
}

export interface StatusHistoryResponse {
  changes: { at: string; column: KanbanColumn; reason: string; source: SessionStatus['source'] }[];
}

export interface IndexHealth {
  state: 'building' | 'ready' | 'error';
  progress?: { completed: number; total: number };
  lastFullScanAt: string | null;
}
export interface HealthResponse { index?: IndexHealth }
export interface SearchResponse {
  results: { projectId: string; sessionId: string; messageUuid: string; timestamp: string | null; role: string | null; model: string | null; snippet: string; cutStart?: boolean; cutEnd?: boolean; highlights: [number, number][] }[];
  nextCursor: string | null;
}
export type LiveEvent =
  | { event: 'project'; data: { projectId: string } }
  | { event: 'session'; data: { projectId: string; sessionId: string } }
  | { event: 'status'; data: { projectId: string; sessionId: string; column: KanbanColumn } }
  | { event: 'config'; data: Record<string, never> }
  | { event: 'index'; data: { state: IndexHealth['state'] } };

// GET /api/usage (inclusive calendar dates, maximum 366 days).
export interface UsageTotal {
  costUsd: number;
  tokens: TokenTotals;
}
export interface UsageModel extends UsageTotal { model: string }
export interface UsageResponse {
  tz: string;
  from: string;
  to: string;
  days: (UsageTotal & { date: string; byModel: UsageModel[] })[];
  byProject: (UsageTotal & { projectId: string; name: string })[];
  byModel: UsageModel[];
  totals: UsageTotal;
  cacheHit: { date: string; ratio: number | null }[];
}

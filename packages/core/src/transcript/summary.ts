import {
  isAssistantRecord,
  isUserRecord,
  type TranscriptRecord,
} from './schemas.js';
import { summarizeUsage, type UsageSummary } from './usage.js';

export interface SessionSummary {
  sessionId: string | undefined;
  title: string | undefined;
  firstAt: string | undefined;
  lastAt: string | undefined;
  models: string[];
  gitBranches: string[];
  cwd: string | undefined;
  version: string | undefined;
  messageCount: number;
  toolUseCounts: Record<string, number>;
  usage: UsageSummary;
  permissionModes: string[];
  errorCount: number;
  malformed: number;
}

const harnessTags =
  /<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|system-reminder)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const harnessPrefixes = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<local-command-caveat>',
  '<system-reminder>',
  'Caveat:',
  '[Request interrupted',
];

function titleFallback(text: string): string | undefined {
  const cleaned = text.replace(harnessTags, '');
  const firstLine = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return undefined;
  if (
    harnessPrefixes.some((prefix) =>
      firstLine.toLowerCase().startsWith(prefix.toLowerCase()),
    )
  )
    return undefined;
  return Array.from(firstLine).slice(0, 120).join('');
}

/** Malformed lines cannot be recovered from parsed records; pass the reader's
 * malformed count when available. Metadata such as cwd/version uses the latest value.
 */
export function summarizeSession(
  records: Iterable<TranscriptRecord>,
  options: { malformed?: number } = {},
): SessionSummary {
  const all = Array.from(records);
  const summary: SessionSummary = {
    sessionId: undefined,
    title: undefined,
    firstAt: undefined,
    lastAt: undefined,
    models: [],
    gitBranches: [],
    cwd: undefined,
    version: undefined,
    messageCount: 0,
    toolUseCounts: Object.create(null) as Record<string, number>,
    usage: summarizeUsage(all),
    permissionModes: [],
    errorCount: 0,
    malformed: options.malformed ?? 0,
  };
  const models = new Set<string>();
  const branches = new Set<string>();
  const modes = new Set<string>();
  const assistants = new Set<string>();
  const tools = new Set<string>();
  let fallback: string | undefined;
  for (const record of all) {
    if (typeof record.sessionId === 'string')
      summary.sessionId = record.sessionId;
    if (typeof record.cwd === 'string') summary.cwd = record.cwd;
    if (typeof record.version === 'string') summary.version = record.version;
    if (typeof record.gitBranch === 'string' && record.gitBranch)
      branches.add(record.gitBranch);
    if (
      typeof record.timestamp === 'string' &&
      Number.isFinite(Date.parse(record.timestamp))
    ) {
      if (
        !summary.firstAt ||
        Date.parse(record.timestamp) < Date.parse(summary.firstAt)
      )
        summary.firstAt = record.timestamp;
      if (
        !summary.lastAt ||
        Date.parse(record.timestamp) > Date.parse(summary.lastAt)
      )
        summary.lastAt = record.timestamp;
    }
    if (
      record.type === 'ai-title' &&
      typeof record.aiTitle === 'string' &&
      record.aiTitle.trim()
    )
      summary.title = record.aiTitle;
    if (
      record.type === 'permission-mode' &&
      typeof record.permissionMode === 'string'
    )
      modes.add(record.permissionMode);
    if (isUserRecord(record)) {
      summary.messageCount++;
      const content = record.message.content;
      if (typeof content !== 'string') {
        for (const block of content)
          if (block.type === 'tool_result' && block.is_error === true)
            summary.errorCount++;
      }
      if (!record.isMeta && !fallback) {
        const text =
          typeof content === 'string'
            ? content
            : content
                .filter(
                  (block) =>
                    block.type === 'text' && typeof block.text === 'string',
                )
                .map((block) => block.text as string)
                .join('\n');
        fallback = titleFallback(text);
      }
    }
    if (isAssistantRecord(record)) {
      models.add(record.message.model);
      if (!assistants.has(record.message.id)) {
        assistants.add(record.message.id);
        summary.messageCount++;
      }
      for (const block of record.message.content) {
        if (
          block.type !== 'tool_use' ||
          typeof block.id !== 'string' ||
          typeof block.name !== 'string' ||
          tools.has(block.id)
        )
          continue;
        tools.add(block.id);
        summary.toolUseCounts[block.name] =
          (summary.toolUseCounts[block.name] ?? 0) + 1;
      }
    }
  }
  summary.title ??= fallback;
  summary.models = [...models];
  summary.gitBranches = [...branches];
  summary.permissionModes = [...modes];
  return summary;
}

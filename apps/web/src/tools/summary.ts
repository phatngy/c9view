import {
  Bot,
  CircleHelp,
  ClipboardList,
  FilePen,
  FilePlus2,
  FileText,
  FolderSearch,
  Globe,
  ListChecks,
  NotebookPen,
  Pencil,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { duration } from '../session/chat/time.js';
import type { ToolUse, ToolResult } from './ToolCard.js';
export function relativePath(path: string, root?: string) {
  if (!root || !path || path.includes('\0')) return undefined;
  const base = root.replace(/\/$/, '');
  const relative = path.startsWith(`${base}/`)
    ? path.slice(base.length + 1)
    : path.startsWith('/')
      ? undefined
      : path;
  if (!relative || relative.split('/').includes('..')) return undefined;
  return relative.replace(/^\.\//, '');
}

export interface SummaryContext {
  projectId?: string | undefined;
  projectPath?: string | undefined;
  callAt?: string | null | undefined;
  resultAt?: string | null | undefined;
}
export interface ToolSummary {
  icon: LucideIcon;
  tone: 'search' | 'edit' | 'run' | 'plan' | 'ask' | 'muted';
  name: string;
  summary: { text: string; mono?: boolean; href?: string }[];
  detail?: string;
  badge?: { text: string; tone: 'muted' | 'success' | 'danger' | 'accent' };
  diff?: { additions: number; deletions: number };
}
export function toolRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}
export function displayToolName(name: string): {
  name: string;
  server?: string;
} {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1]!, name: match[2]! } : { name };
}
export function toolDuration(callAt?: string | null, resultAt?: string | null) {
  if (!callAt || !resultAt) return undefined;
  const delta = Date.parse(resultAt) - Date.parse(callAt);
  return Number.isFinite(delta) && delta >= 0 && delta <= 21600000
    ? delta < 1000
      ? '<1s'
      : duration(delta)
    : undefined;
}
export function countReadLines(text: string) {
  return text.split('\n').filter((line) => /^\s*\d+[\t→]/.test(line)).length;
}
const nonempty = (text: string) =>
  text.split('\n').filter((line) => line.trim());
export function countGrepResult(text: string, mode?: string) {
  if (/No (?:files|matches) found/i.test(text)) return 'no matches';
  const total = /Found (\d+) total occurrences? across (\d+) files?/i.exec(text);
  if (total) return `${total[1]} ${total[1] === '1' ? 'match' : 'matches'}`;
  const files = /Found (\d+) files?/i.exec(text);
  if (files) return `${files[1]} ${files[1] === '1' ? 'file' : 'files'}`;
  const lines = nonempty(text);
  const matches = mode === 'content' || lines.some((line) => /^.+?:\d+:/.test(line));
  return `${lines.length} ${matches ? (lines.length === 1 ? 'match' : 'matches') : lines.length === 1 ? 'line' : 'lines'}`;
}
export function parseExit(
  results: ToolResult[],
  input: Record<string, unknown> = {},
) {
  const text = results.map((result) => result.text).join('\n');
  if (!results.length) return 'running';
  if (
    results.some(
      (result) =>
        /^\[Request interrupted/.test(result.text) ||
        (result.isError && result.text.includes('[Request interrupted')),
    )
  )
    return 'interrupted';
  if (
    input.run_in_background === true ||
    /^Command running in background with ID:/m.test(text)
  )
    return 'background';
  if (/^Permission to use Bash .*has been denied\./s.test(text))
    return 'denied';
  const exit = /^Exit code (\d+)/.exec(text);
  return exit
    ? `exit ${exit[1]}`
    : results.some((result) => result.isError)
      ? 'error'
      : 'exit 0';
}
export function resultBadge(
  results: ToolResult[],
  fallback = 'done',
): NonNullable<ToolSummary['badge']> {
  return results.some((result) => result.isError)
    ? { text: 'error', tone: 'danger' }
    : { text: results.length ? fallback : 'pending', tone: 'muted' };
}
export function toolSummary(
  block: ToolUse,
  results: ToolResult[] = [],
  ctx: SummaryContext = {},
): ToolSummary {
  const input =
    block.input && typeof block.input === 'object'
      ? (block.input as Record<string, unknown>)
      : {};
  const str = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string) : '';
  const text = results.map((result) => result.text).join('\n');
  const error = results.some((result) => result.isError);
  const s: ToolSummary = {
    icon: Wrench,
    tone: 'muted',
    name: displayToolName(block.name).name,
    summary: [],
    badge: resultBadge(results, `${nonempty(text).length} lines`),
  };
  const summary = (value: string, mono = false) => {
    s.summary = value ? [{ text: value.slice(0, 160), mono }] : [];
  };
  const path =
    str('file_path') ||
    str('notebook_path') ||
    str('path') ||
    block.change?.filePath ||
    '';
  const file = (line?: number) => {
    const relative = relativePath(path, ctx.projectPath);
    s.summary = [
      {
        text: relative || path,
        mono: true,
        ...(relative && ctx.projectId
          ? {
              href: `/projects/${encodeURIComponent(ctx.projectId)}?${new URLSearchParams({ tab: 'files', path: relative, ...(line ? { line: String(line) } : {}) })}`,
            }
          : {}),
      },
    ];
  };
  switch (block.name) {
    case 'Read': {
      s.icon = FileText;
      s.tone = 'search';
      file(typeof input.offset === 'number' ? input.offset : undefined);
      const numbered = text
        .split('\n')
        .map((line) => /^\s*(\d+)[\t→]/.exec(line)?.[1])
        .filter(Boolean);
      if (numbered.length) s.detail = `lines ${numbered[0]}–${numbered.at(-1)}`;
      else if (typeof input.offset === 'number')
        s.detail = `from line ${input.offset}`;
      s.badge = resultBadge(results, `${countReadLines(text)} lines`);
      break;
    }
    case 'Grep':
      s.icon = Search;
      s.tone = 'search';
      summary(str('pattern'), true);
      if (path || str('glob') || str('type'))
        s.detail = `in ${relativePath(path, ctx.projectPath) || path || str('glob') || str('type')}`;
      s.badge = resultBadge(
        results,
        countGrepResult(text, str('output_mode') || 'files_with_matches'),
      );
      break;
    case 'Glob':
      s.icon = FolderSearch;
      s.tone = 'search';
      summary(str('pattern'), true);
      if (path) s.detail = `in ${relativePath(path, ctx.projectPath) || path}`;
      s.badge = resultBadge(
        results,
        /No files found/i.test(text)
          ? 'no files'
          : `${nonempty(text).filter((line) => !/^\(Results are truncated/i.test(line)).length} files`,
      );
      break;
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      s.icon =
        block.name === 'Write'
          ? block.change?.kind === 'create'
            ? FilePlus2
            : FilePen
          : block.name === 'NotebookEdit'
            ? NotebookPen
            : Pencil;
      s.tone = 'edit';
      file(block.change?.hunks[0]?.newStart || 1);
      if (block.change)
        s.diff = {
          additions: block.change.additions,
          deletions: block.change.deletions,
        };
      s.badge = resultBadge(results, 'edited');
      break;
    case 'Bash': {
      s.icon = SquareTerminal;
      s.tone = 'run';
      summary(
        str('description') || str('command').split('\n')[0] || '',
        !str('description'),
      );
      const exit = parseExit(results, input);
      const elapsed = toolDuration(ctx.callAt, ctx.resultAt);
      s.badge = {
        text:
          exit +
          (elapsed && !['background', 'running'].includes(exit)
            ? ` · ${elapsed}`
            : ''),
        tone:
          exit === 'exit 0'
            ? 'success'
            : ['error', 'denied'].includes(exit) || /^exit [1-9]/.test(exit)
              ? 'danger'
              : 'muted',
      };
      break;
    }
    case 'BashOutput':
    case 'KillShell':
    case 'KillBash':
    case 'TaskStop':
      s.icon = SquareTerminal;
      s.tone = 'run';
      summary(str('bash_id') || str('shell_id') || str('task_id'), true);
      s.badge = resultBadge(results);
      break;
    case 'WebFetch':
      s.icon = Globe;
      s.tone = 'search';
      try {
        const url = new URL(str('url'));
        summary(url.host + url.pathname + url.search, true);
      } catch {
        summary(str('url'), true);
      }
      break;
    case 'WebSearch':
      s.icon = Globe;
      s.tone = 'search';
      summary(str('query'));
      s.badge = resultBadge(results);
      break;
    case 'Task':
    case 'Agent':
      s.icon = Bot;
      summary(str('description'));
      if (str('subagent_type') || str('model'))
        s.detail = [str('subagent_type'), str('model')]
          .filter(Boolean)
          .join(' · ');
      s.badge = resultBadge(
        results,
        /^Async agent launched/.test(text) ? 'async' : 'done',
      );
      if (!results.length) s.badge.text = 'running';
      break;
    case 'TodoWrite': {
      s.icon = ListChecks;
      s.name = 'Todos';
      const todos = toolRecords(input.todos);
      s.badge = {
        text: `${todos.filter((todo) => todo.status === 'completed').length} of ${todos.length} done`,
        tone: 'muted',
      };
      break;
    }
    case 'AskUserQuestion': {
      s.icon = CircleHelp;
      s.tone = 'ask';
      const questions = toolRecords(input.questions);
      summary(
        (typeof questions[0]?.question === 'string'
          ? questions[0].question
          : '') +
          (questions.length > 1 ? ` (+${questions.length - 1} more)` : ''),
      );
      const waiting = !results.length && input.answers === undefined;
      s.badge = {
        text: waiting ? 'waiting' : error ? 'failed' : 'answered',
        tone: waiting ? 'accent' : error ? 'danger' : 'muted',
      };
      break;
    }
    case 'ExitPlanMode':
    case 'EnterPlanMode':
    case 'plan':
      s.icon = ClipboardList;
      s.tone = 'plan';
      summary(nonempty(str('plan') || str('text') || str('content'))[0] || '');
      s.badge = {
        text: !results.length
          ? 'pending'
          : /approved/i.test(text) && !/not approved|unapproved/i.test(text)
            ? 'approved'
            : 'not approved',
        tone: 'muted',
      };
      break;
    case 'Skill':
    case 'SlashCommand':
      s.icon = Sparkles;
      summary(str('skill') || str('command'), true);
      s.badge = resultBadge(results);
      break;
    case 'ToolSearch':
      s.icon = Search;
      summary(str('query'), true);
      s.badge = resultBadge(results);
      break;
    default:
      if (block.name.startsWith('mcp__')) s.icon = Plug;
      summary(
        (
          Object.values(input).find((value) => typeof value === 'string') as
            string | undefined
        )?.slice(0, 80) || '',
      );
  }
  return s;
}

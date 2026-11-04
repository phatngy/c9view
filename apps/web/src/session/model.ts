import type { Message } from '@c9view/api';
import { classifyMessage } from './markup.js';
import { displayToolName } from '../tools/summary.js';

export const messageAnchor = (id: string) => `m-${id}`;
// Traverse only enough input to fill the summary; never stringify an entire payload.
export function summarizeInput(input: unknown) {
  let summary = '';
  const seen = new Set<object>();
  const append = (text: string) => {
    summary += text.slice(0, 2000 - summary.length);
  };
  function visit(value: unknown, depth = 0) {
    if (summary.length >= 2000) return;
    if (typeof value === 'string') {
      append(JSON.stringify(value.slice(0, 2000 - summary.length)));
      return;
    }
    if (!value || typeof value !== 'object') {
      append(String(value));
      return;
    }
    if (seen.has(value) || depth > 20) {
      append('…');
      return;
    }
    seen.add(value);
    append(Array.isArray(value) ? '[' : '{');
    let first = true;
    for (const key in value) {
      if (summary.length >= 2000) break;
      if (!Object.hasOwn(value, key)) continue;
      if (!first) append(',');
      first = false;
      if (!Array.isArray(value)) {
        append(JSON.stringify(key.slice(0, 2000 - summary.length)));
        append(':');
      }
      visit((value as Record<string, unknown>)[key], depth + 1);
    }
    append(Array.isArray(value) ? ']' : '}');
    seen.delete(value);
  }
  visit(input);
  // A UTF-8 byte cap also bounds non-ASCII tool inputs to 2 KB.
  const bytes = new TextEncoder().encode(summary);
  return bytes.length <= 2000
    ? summary
    : new TextDecoder().decode(bytes.subarray(0, 2000), { stream: true });
}
export function buildSearchIndex(messages: Message[]) {
  return messages.map((message) => ({
    message,
    text: searchableText(message).toLocaleLowerCase(),
  }));
}
export function searchableText(message: Message) {
  const displayed =
    message.role === 'assistant'
      ? message.blocks.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        )
      : classifyMessage(message).segments.map((segment) => {
          if (segment.kind === 'command')
            return `${segment.name} ${segment.args}`;
          if (segment.kind === 'task') return segment.summary;
          return segment.text;
        });
  return [
    ...displayed,
    ...message.blocks.flatMap((block) =>
      block.type === 'tool_use'
        ? [`${block.name} ${summarizeInput(block.input)}`]
        : [],
    ),
  ].join('\n');
}
export interface OutlineEntry {
  id: string;
  label: string;
  time: string | null;
  kind: 'prompt' | 'command' | 'question' | 'plan';
}
function outlineToolLabel(name: string, input: unknown) {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;
  let label: string;
  if (name === 'AskUserQuestion') {
    const questions = Array.isArray(record?.questions) ? record.questions : [];
    const first = questions[0];
    const question =
      first && typeof first === 'object' && !Array.isArray(first)
        ? (first as Record<string, unknown>).question
        : undefined;
    label =
      typeof question === 'string' && question.trim()
        ? question.trim()
        : 'Question';
    if (questions.length > 1) label += ` (+${questions.length - 1} more)`;
  } else {
    const plan = record?.plan;
    label =
      typeof plan === 'string'
        ? (plan
            .split('\n')
            .find((line) => line.trim())
            ?.trim() ?? 'Plan')
        : 'Plan';
  }
  return label.length > 120 ? `${label.slice(0, 117).trimEnd()}…` : label;
}
export function outlineEntries(messages: Message[]): OutlineEntry[] {
  return messages.flatMap((message) => {
    const entries: OutlineEntry[] = [];
    const { kind, segments } = classifyMessage(message);
    if (!message.isMeta && !message.isSidechain && kind === 'prompt') {
      const text = segments.find(
        (segment) => segment.kind === 'text' && segment.text.trim(),
      );
      const pasted = segments.find((segment) => segment.kind === 'pasted');
      const label =
        text?.kind === 'text'
          ? text.text
              .split('\n')
              .find((line) => line.trim())
              ?.trim()
          : pasted?.kind === 'pasted'
            ? `Pasted text (${pasted.lines} lines)`
            : undefined;
      if (label)
        entries.push({
          id: message.uuid,
          label,
          time: message.timestamp,
          kind: 'prompt',
        });
    } else if (!message.isMeta && !message.isSidechain && kind === 'command') {
      for (const segment of segments) {
        if (segment.kind === 'command')
          entries.push({
            id: message.uuid,
            label: `${segment.name} ${segment.args}`.trim(),
            time: message.timestamp,
            kind: 'command',
          });
      }
    }
    for (const block of message.blocks) {
      if (
        block.type === 'tool_use' &&
        ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'plan'].includes(
          block.name,
        )
      ) {
        entries.push({
          id: message.uuid,
          label: outlineToolLabel(block.name, block.input),
          time: message.timestamp,
          kind: block.name === 'AskUserQuestion' ? 'question' : 'plan',
        });
      }
    }
    return entries;
  });
}
export function groupMessages(messages: Message[]) {
  const groups: Message[][] = [];
  let run: Message[] = [];
  function flush() {
    const calls = run.reduce(
      (count, m) =>
        count + m.blocks.filter((b) => b.type === 'tool_use').length,
      0,
    );
    if (calls > 1) groups.push(run);
    else groups.push(...run.map((m) => [m]));
    run = [];
  }
  for (const message of messages) {
    const hasText = message.blocks.some((b) => b.type === 'text');
    const interaction = message.blocks.some(
      (block) =>
        block.type === 'tool_use' &&
        ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'plan'].includes(
          block.name,
        ),
    );
    const absorb =
      !hasText &&
      !interaction &&
      (message.isMeta ||
        (message.role === 'assistant' &&
          message.blocks.every((b) =>
            ['thinking', 'tool_use', 'tool_result'].includes(b.type),
          )) ||
        (message.role === 'user' &&
          message.blocks.length > 0 &&
          message.blocks.every((b) => b.type === 'tool_result')));
    if (absorb) run.push(message);
    else {
      flush();
      groups.push([message]);
    }
  }
  flush();
  return groups;
}

export function summarizeGroup(
  messages: Message[],
  resultSource: Map<string, string | null> | Message[] = messages,
) {
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  let additions = 0;
  let deletions = 0;
  let startAt: string | null = null;
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type !== 'tool_use') continue;
      if (!ids.size) startAt = message.timestamp;
      ids.add(block.id);
      const name = displayToolName(block.name).name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      additions += block.change?.additions ?? 0;
      deletions += block.change?.deletions ?? 0;
    }
  }
  const resultTimes = Array.isArray(resultSource)
    ? resultSource.flatMap((message) =>
        message.timestamp &&
        message.blocks.some(
          (block) => block.type === 'tool_result' && ids.has(block.toolUseId),
        )
          ? [message.timestamp]
          : [],
      )
    : [...ids]
        .map((id) => resultSource.get(id))
        .filter((timestamp): timestamp is string => !!timestamp);
  const endAt = resultTimes.reduce<string | null>(
    (latest, timestamp) =>
      !latest || Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest,
    null,
  );
  return {
    count: [...counts.values()].reduce((sum, count) => sum + count, 0),
    names: [...counts].map(([name, count]) => ({ name, count })),
    additions,
    deletions,
    startAt,
    endAt,
  };
}

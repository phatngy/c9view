import type { Message } from '@c9view/api';

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'command'; name: string; args: string }
  | { kind: 'stdout'; text: string; lines: number }
  | { kind: 'pasted'; id: string | null; text: string; lines: number }
  | { kind: 'task'; status: string | null; summary: string };
export type MessageKind =
  | 'prompt'
  | 'command'
  | 'local-output'
  | 'task-notification'
  | 'note'
  | 'other';

const known = new Set([
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-caveat',
  'pasted_content',
  'task-notification',
  'system-reminder',
]);
const runsToEnd = new Set([
  'local-command-stdout',
  'pasted_content',
  'task-notification',
]);
interface Tag {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  id: string | null;
}

// Tokenize once, keeping unknown markup in the intervening literal text.
function tags(text: string): Tag[] {
  const result: Tag[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    let end = start + 1;
    while (end < text.length && text[end] !== '<' && text[end] !== '>') end++;
    if (end === text.length) break;
    if (text[end] === '<') {
      cursor = end;
      continue;
    }
    const raw = text.slice(start, end + 1);
    const match = /^<(\/)?([\w-]+)(?=[\s>])([^<>]*)>$/.exec(raw);
    if (match && known.has(match[2]!.toLowerCase())) {
      result.push({
        start,
        end: end + 1,
        name: match[2]!.toLowerCase(),
        closing: Boolean(match[1]),
        id: /\bid\s*=\s*["']([^"']*)["']/i.exec(match[3]!)?.[1] ?? null,
      });
    }
    cursor = end + 1;
  }
  return result;
}

export function stripAnsi(text: string): string {
  // ANSI CSI and OSC sequences deliberately contain terminal control bytes.
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\][^\u0007]*\u0007/g, '')
  );
}
const lineCount = (text: string) => text.split('\n').length;
function taskField(body: string, name: 'summary' | 'status'): string | null {
  const open = new RegExp(`<${name}(?:\\s[^<>]*)?>`, 'i').exec(body);
  if (!open) return null;
  const start = open.index + open[0].length;
  const close = new RegExp(`</${name}(?:\\s[^<>]*)?>`, 'i').exec(
    body.slice(start),
  );
  return (
    body.slice(start, close ? start + close.index : undefined).trim() || null
  );
}

export function parseMarkup(text: string): Segment[] {
  const tokens = tags(text);
  // Reverse indices keep even mismatched pasted ids linear in transcript size.
  const closes = new Map<string, number>();
  const matching = new Map<number, number>();
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tag = tokens[i]!;
    const idKey = `${tag.name}:${tag.id}`;
    if (tag.closing) {
      closes.set(tag.name, i);
      if (tag.id !== null) closes.set(idKey, i);
    } else {
      const exact =
        tag.name === 'pasted_content' && tag.id !== null
          ? closes.get(idKey)
          : undefined;
      matching.set(i, exact ?? closes.get(tag.name) ?? -1);
    }
  }
  const segments: Segment[] = [];
  let command: Extract<Segment, { kind: 'command' }> | undefined;
  const addText = (value: string) => {
    const text = value.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
    if (text.trim()) segments.push({ kind: 'text', text });
  };
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i]!;
    if (tag.closing) continue;
    const closing = matching.get(i) ?? -1;
    // Only payload tags may omit a closing tag. Other openings are ordinary
    // prompt text, and later recognized tags still need to be parsed.
    if (closing < 0 && !runsToEnd.has(tag.name)) continue;
    addText(text.slice(cursor, tag.start));
    const body = text.slice(
      tag.end,
      closing < 0 ? undefined : tokens[closing]!.start,
    );
    switch (tag.name) {
      case 'command-name': {
        const name = body.trim();
        command = {
          kind: 'command',
          name: name.startsWith('/') ? name : `/${name}`,
          args: '',
        };
        segments.push(command);
        break;
      }
      case 'command-args': {
        if (command) command.args = body.trim();
        break;
      }
      case 'local-command-stdout': {
        const output = stripAnsi(body).trim();
        if (output)
          segments.push({
            kind: 'stdout',
            text: output,
            lines: lineCount(output),
          });
        break;
      }
      case 'pasted_content': {
        const pasted = body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
        segments.push({
          kind: 'pasted',
          id: tag.id,
          text: pasted,
          lines: lineCount(pasted),
        });
        break;
      }
      case 'task-notification':
        segments.push({
          kind: 'task',
          status: taskField(body, 'status'),
          summary: taskField(body, 'summary') ?? 'Background task update',
        });
        break;
    }
    cursor = closing < 0 ? text.length : tokens[closing]!.end;
    if (closing < 0) break;
    i = closing;
  }
  addText(text.slice(cursor));
  return segments;
}

const classifications = new WeakMap<
  Message,
  { kind: MessageKind; segments: Segment[] }
>();
const harnessNotice =
  /^\s*<(system-reminder|task-notification)(?:\s[^<>]*)?>[\s\S]*?<\/\1>\s*/i;
export function parseAssistantNotices(text: string): Segment[] | null {
  const segments: Segment[] = [];
  let remaining = text;
  while (remaining.trim()) {
    const match = harnessNotice.exec(remaining);
    if (!match) return null;
    const opening =
      /^\s*<(system-reminder|task-notification)(?:\s[^<>]*)?>/i.exec(
        match[0],
      );
    if (!opening) return null;
    if (opening[1]!.toLowerCase() === 'system-reminder') {
      const close = /<\/system-reminder>\s*$/i.exec(match[0]);
      if (!close) return null;
      const note = match[0].slice(opening[0].length, close.index).trim();
      if (note) segments.push({ kind: 'note', text: note });
    } else {
      segments.push(...parseMarkup(match[0]));
    }
    remaining = remaining.slice(match[0].length);
  }
  return segments.length ? segments : null;
}

export function classifyMessage(message: Message): {
  kind: MessageKind;
  segments: Segment[];
} {
  const cached = classifications.get(message);
  if (cached) return cached;
  const raw = message.blocks.flatMap((block) =>
    block.type === 'text' ? [block.text] : [],
  );
  const assistantNotices =
    message.role === 'assistant'
      ? raw.filter((text) => text.trim()).map(parseAssistantNotices)
      : [];
  const segments =
    message.role === 'assistant'
      ? assistantNotices.length > 0 &&
        assistantNotices.every((notice) => notice !== null)
        ? assistantNotices.flatMap((notice) => notice ?? [])
        : raw
            .filter((text) => text.trim())
            .map((text): Segment => ({ kind: 'text', text }))
      : raw.flatMap(parseMarkup);
  const hasText = segments.some(
    (segment) => segment.kind === 'text' && segment.text.trim(),
  );
  const imageOnlyPrompt =
    message.role === 'user' &&
    !message.isMeta &&
    !message.isSidechain &&
    message.blocks.some((block) => block.type === 'image') &&
    !message.blocks.some(
      (block) =>
        block.type !== 'image' && (block.type !== 'text' || block.text.trim()),
    );
  let kind: MessageKind = 'other';
  if (
    message.role === 'assistant' &&
    segments.length > 0 &&
    segments.every((segment) => segment.kind === 'task' || segment.kind === 'note')
  )
    kind = segments.some((segment) => segment.kind === 'task')
      ? 'task-notification'
      : 'note';
  if (message.role !== 'assistant') {
    if (segments.some((segment) => segment.kind === 'command') && !hasText)
      kind = 'command';
    else if (
      segments.length &&
      segments.every((segment) => segment.kind === 'stdout')
    )
      kind = 'local-output';
    else if (
      segments.length &&
      segments.every((segment) => segment.kind === 'task')
    )
      kind = 'task-notification';
    else if (
      message.role === 'user' &&
      !message.isMeta &&
      !message.isSidechain &&
      (hasText ||
        segments.some((segment) => segment.kind === 'pasted') ||
        imageOnlyPrompt)
    )
      kind = 'prompt';
    else if (message.role === 'system' && hasText) kind = 'note';
  }
  const result = { kind, segments };
  classifications.set(message, result);
  return result;
}

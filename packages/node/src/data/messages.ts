import { inlineChanges } from './inline-changes.js';
import {
  extractUsage,
  isAssistantRecord,
  isUserRecord,
  redactText,
  redactValue,
  type TranscriptRecord,
} from '@c9view/core';
import { redacted, redactStrings } from './redaction.js';
import type { Message, MessageBlock, TokenTotals } from '@c9view/api';

export function tokens(value: TokenTotals): TokenTotals {
  return {
    input: Math.trunc(value.input),
    output: Math.trunc(value.output),
    cacheRead: Math.trunc(value.cacheRead),
    cacheCreation: Math.trunc(value.cacheCreation),
    thinking: Math.trunc(value.thinking),
  };
}
const marker = '… truncated';
export function capped(text: string): string {
  const safe = redactText(text);
  return safe.length <= 20_000
    ? safe
    : safe.slice(0, 20_000 - marker.length) + marker;
}
function block(value: Record<string, unknown>): MessageBlock | null {
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string'
        ? { type: 'text', text: capped(value.text) }
        : null;
    case 'thinking':
      return typeof value.thinking === 'string'
        ? { type: 'thinking', text: capped(value.thinking) }
        : null;
    case 'image':
      return { type: 'image' };
    case 'tool_use': {
      if (typeof value.id !== 'string' || typeof value.name !== 'string')
        return null;
      const input = redactValue(value.input);
      const json = JSON.stringify(input) ?? 'null';
      return {
        type: 'tool_use',
        id: redactText(value.id),
        name: redactText(value.name),
        input: json.length > 20_000 ? capped(json) : input,
      };
    }
    case 'tool_result': {
      if (typeof value.tool_use_id !== 'string') return null;
      const text =
        typeof value.content === 'string'
          ? value.content
          : Array.isArray(value.content)
            ? value.content
                .map((part: unknown) =>
                  part &&
                  typeof part === 'object' &&
                  'text' in part &&
                  typeof part.text === 'string'
                    ? part.text
                    : '',
                )
                .filter(Boolean)
                .join('\n')
            : '';
      return {
        type: 'tool_result',
        toolUseId: redactText(value.tool_use_id),
        isError: value.is_error === true,
        text: capped(text),
      };
    }
    default:
      return null;
  }
}
export function messages(records: TranscriptRecord[]): Message[] {
  const result: Message[] = [];
  const changes = inlineChanges(records);
  for (const [index, record] of records.entries()) {
    const assistant = isAssistantRecord(record);
    const user = isUserRecord(record);
    if (!assistant && !user && record.type !== 'system') continue;
    const content =
      assistant || user
        ? record.message.content
        : typeof record.content === 'string'
          ? record.content
          : '';
    const blocks =
      typeof content === 'string'
        ? [{ type: 'text' as const, text: capped(content) }]
        : content.map(block).filter((b): b is MessageBlock => b !== null);
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const change = changes.get(block.id);
        if (change) block.change = change;
      }
    }
    result.push({
      uuid: typeof record.uuid === 'string' ? record.uuid : `record-${index}`,
      role: assistant ? 'assistant' : user ? 'user' : 'system',
      timestamp:
        typeof record.timestamp === 'string' &&
        Number.isFinite(Date.parse(record.timestamp))
          ? new Date(record.timestamp).toISOString()
          : null,
      model: assistant ? record.message.model : null,
      isMeta: record.isMeta === true,
      isSidechain: record.isSidechain === true,
      blocks,
      usage:
        assistant && record.message.usage
          ? tokens(extractUsage(record.message.usage))
          : null,
    });
  }
  return result.map((message) => redacted(redactStrings(message)));
}

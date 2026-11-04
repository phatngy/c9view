import type { Message } from '@c9view/api';
import type { ToolUse } from '../../tools/ToolCard.js';
import { classifyMessage } from '../markup.js';

type Variant = 'row' | 'card';
interface EstimateOptions {
  variant?: Variant | undefined;
  compact?: boolean | undefined;
  openChange?: boolean | undefined;
  startsAssistant?: boolean | undefined;
}

export function estimateTool(
  block: ToolUse,
  variant: Variant,
  compact = false,
  openChange = false,
): number {
  const input: Record<string, unknown> =
    typeof block.input === 'object' && block.input !== null
      ? (block.input as Record<string, unknown>)
      : {};
  const closed = variant === 'row' ? 41 : 44;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(block.name)) {
    if (!block.change) return 72;
    const lines = block.change.hunks.reduce(
      (sum, hunk) => sum + hunk.lines.length + 1,
      0,
    );
    return 44 + Math.min(lines, 40) * 22 + 14 + (openChange ? 32 : 0);
  }
  if (block.name === 'Bash') {
    if (variant === 'row') return closed;
    if (compact) return 84;
    const lines =
      typeof input.command === 'string' ? input.command.split('\n').length : 1;
    return 44 + Math.min(lines, 5) * 20 + 20 + 140;
  }
  if (block.name === 'TodoWrite')
    return variant === 'row'
      ? closed
      : 48 + 28 * (Array.isArray(input.todos) ? input.todos.length : 0);
  if (block.name === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const options = questions.reduce((count: number, question: unknown) => {
      if (typeof question !== 'object' || question === null) return count;
      const values = (question as Record<string, unknown>).options;
      return count + (Array.isArray(values) ? values.length : 0);
    }, 0);
    return 96 + 28 * questions.length + 36 * Math.ceil(options / 2);
  }
  if (['ExitPlanMode', 'EnterPlanMode', 'plan'].includes(block.name))
    return 240;
  return closed;
}

export function estimateRow(
  group: Message[],
  startsWithDivider = false,
  {
    variant = 'card',
    compact = false,
    openChange = false,
    startsAssistant = false,
  }: EstimateOptions = {},
): number {
  const first = group[0];
  if (!first) return startsWithDivider ? 32 : 120;
  const calls = group.flatMap((message) =>
    message.blocks.filter(
      (block): block is ToolUse => block.type === 'tool_use',
    ),
  );
  const { kind, segments } = classifyMessage(first);
  let base: number;
  const hasInteraction = calls.some((block) =>
    ['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'plan'].includes(
      block.name,
    ),
  );
  if (calls.length > 1 && variant !== 'row' && !hasInteraction) {
    base = (compact ? 52 : 42) + (startsAssistant ? 42 : 0) + 20;
  } else if (calls.length) {
    base = calls.reduce(
      (sum, block) => sum + estimateTool(block, variant, compact, openChange),
      0,
    );
    if (
      first.blocks.some((block) => block.type === 'text' && block.text.trim())
    )
      base += 140;
    if (variant === 'row')
      base +=
        first.blocks.filter((block) => block.type === 'thinking').length * 42;
  } else if (
    variant === 'row' &&
    first.blocks.some((block) => block.type === 'thinking')
  ) {
    base = 42;
  } else {
    base = ['command', 'local-output', 'task-notification'].includes(kind)
      ? 56
      : kind === 'prompt'
        ? 96 + (segments.some((segment) => segment.kind === 'pasted') ? 44 : 0)
        : first.role === 'assistant' &&
            first.blocks.some((block) => block.type === 'text')
          ? 140
          : 120;
  }
  return base + (startsWithDivider ? 32 : 0);
}

import { useEffect, useId, useMemo, type ReactNode } from 'react';
import type { Message } from '@c9view/api';
import { ChevronRight } from 'lucide-react';
import { toolDuration } from '../tools/summary.js';
import { estimateRow } from './chat/estimate.js';
import { type summarizeGroup } from './model.js';
import { WindowedMessages } from './WindowedMessages.js';

export function ToolGroup({
  messages,
  target,
  jumpVersion,
  expanded,
  toggle,
  render,
  summary,
  compact = false,
  openChange = false,
}: {
  messages: Message[];
  target?: string | undefined;
  jumpVersion: number;
  expanded: boolean;
  toggle: () => void;
  render: (message: Message) => ReactNode;
  summary: ReturnType<typeof summarizeGroup>;
  compact?: boolean | undefined;
  openChange?: boolean;
}) {
  const groups = useMemo(
    () => messages.map((message) => [message]),
    [messages],
  );
  const groupId = useId();
  const targeted = messages.some(
    (message) =>
      message.uuid === target ||
      message.blocks.some(
        (block) => block.type === 'tool_use' && block.id === target,
      ),
  );
  useEffect(() => {
    if (targeted && !expanded) toggle();
  }, [targeted, expanded, toggle]);
  const open = expanded || targeted;
  const duration = toolDuration(summary.startAt, summary.endAt);
  const names = summary.names
    .slice(0, 4)
    .map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name));
  if (summary.names.length > 4) names.push(`+${summary.names.length - 4} more`);
  return (
    <section className="tool-group rounded-xl border border-line bg-panel overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={groupId}
        className={`flex h-10 w-full rounded-none border-0 bg-transparent py-0 items-center gap-2.5 px-3.5 text-left text-small max-sm:min-h-12! focus-visible:outline-2 focus-visible:outline-accent ${open ? 'border-b border-line' : ''}`}
        onClick={toggle}
      >
        <ChevronRight
          aria-hidden="true"
          size={14}
          className={`shrink-0 motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className="shrink-0 font-medium">{summary.count} tool calls</span>
        <span className="truncate text-muted">{names.join(' · ')}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          {summary.additions + summary.deletions > 0 && (
            <span className="font-mono text-small">
              <span aria-hidden="true" className="text-success">
                +{summary.additions}
              </span>{' '}
              <span aria-hidden="true" className="text-danger">
                −{summary.deletions}
              </span>
              <span className="sr-only">
                {summary.additions} additions, {summary.deletions} deletions
              </span>
            </span>
          )}
          {duration && !compact && (
            <span className="text-muted">{duration}</span>
          )}
        </span>
      </button>
      {open && (
        <div id={groupId}>
          <WindowedMessages
            inline
            estimate={(group) =>
              estimateRow(group, false, { variant: 'row', compact, openChange })
            }
            jumpVersion={jumpVersion}
            groups={groups}
            enabled={messages.length > 300}
            target={target}
            render={(group) => render(group[0]!)}
          />
        </div>
      )}
    </section>
  );
}

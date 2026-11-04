import { useEffect, useId, useState } from 'react';
import type { MessageBlock, SessionDetailResponse } from '@c9view/api';
import { Markdown } from '../markdown.js';
import { useDiffMode } from '../diff/mode.js';
import { SegmentedControl } from '../kit/SegmentedControl.js';
import { toolSummary, type SummaryContext } from './summary.js';
import { ToolRow } from './ToolRow.js';
import { BashCard } from './BashCard.js';
import { TodoCard } from './TodoCard.js';
import { QuestionCard } from './QuestionCard.js';
import { EditBody } from './EditBody.js';
export type ToolUse = Extract<MessageBlock, { type: 'tool_use' }>;
export type ToolResult = Extract<MessageBlock, { type: 'tool_result' }>;
export interface ToolContext {
  revealToolId?: string | undefined;
  projectId?: string;
  projectPath?: string | undefined;
  subagents?: SessionDetailResponse['subagents'];
  openSubagent?: (id: string) => void;
  openChange?: (toolUseId: string) => void;
  compact?: boolean | undefined;
}
export const toolAnchor = (id: string) => `tool-${encodeURIComponent(id)}`;
export { relativePath } from './summary.js';
export function Result({ result }: { result: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const lines = result.text.split('\n');
  const long = lines.length > 20;
  return (
    <div className="min-w-0 bg-page">
      {result.isError && (
        <span className="px-3.5 text-xs text-danger">Tool error</span>
      )}
      <pre
        id={id}
        className="m-0 overflow-x-auto rounded-none bg-page whitespace-pre-wrap px-3.5 py-2.5 font-mono text-small"
      >
        {long && !expanded ? lines.slice(0, 20).join('\n') : result.text}
      </pre>
      {long && (
        <button
          type="button"
          className="px-3.5 text-muted max-sm:min-h-11"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show all'} ({lines.length} lines)
        </button>
      )}
    </div>
  );
}
function Prompt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const lines = text.split('\n');
  return (
    <div className="px-3.5 py-2.5">
      <div id={id}>
        <Markdown
          text={
            lines.length > 20 && !expanded
              ? lines.slice(0, 20).join('\n')
              : text
          }
        />
      </div>
      {lines.length > 20 && (
        <button
          type="button"
          className="max-sm:min-h-11"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show all'} ({lines.length} lines)
        </button>
      )}
    </div>
  );
}
export function ToolCard({
  block,
  results = [],
  context = {},
  variant = 'card',
  timing = {},
}: {
  block: ToolUse;
  results?: ToolResult[] | undefined;
  context?: ToolContext;
  variant?: 'row' | 'card';
  timing?: Pick<SummaryContext, 'callAt' | 'resultAt'>;
}) {
  const input =
    block.input && typeof block.input === 'object'
      ? (block.input as Record<string, unknown>)
      : {};
  const str = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string) : '';
  const edit = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(
    block.name,
  );
  const plan = ['ExitPlanMode', 'EnterPlanMode', 'plan'].includes(block.name);
  const fixed = block.name === 'TodoWrite' && variant === 'card';
  const [open, setOpen] = useState(
    () =>
      edit ||
      plan ||
      block.name === 'AskUserQuestion' ||
      fixed ||
      (block.name === 'Bash' && variant === 'card' && !context.compact),
  );
  const revealed = context.revealToolId === block.id;
  useEffect(() => {
    // Preserve the opened row after an external jump target moves away.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (revealed) setOpen(true);
  }, [revealed]);
  const expanded = open || revealed;
  const id = useId();
  const [mode, setMode] = useDiffMode();
  const summary = toolSummary(block, results, { ...context, ...timing });
  let body;
  if (block.name === 'Bash')
    body = <BashCard command={str('command')} results={results} />;
  else if (edit)
    body = <EditBody block={block} context={context} mode={mode} />;
  else if (block.name === 'TodoWrite') body = <TodoCard todos={input.todos} />;
  else if (plan)
    body = (
      <div className="px-3.5 py-2.5">
        <Markdown
          text={
            str('plan') ||
            str('text') ||
            str('content') ||
            'Plan text unavailable.'
          }
        />
      </div>
    );
  else if (block.name === 'Agent' || block.name === 'Task')
    body = <Prompt text={str('prompt')} />;
  else {
    const known = [
      'Read',
      'Grep',
      'Glob',
      'WebFetch',
      'WebSearch',
      'BashOutput',
      'KillShell',
      'KillBash',
      'TaskStop',
      'Skill',
      'SlashCommand',
      'ToolSearch',
    ].includes(block.name);
    const options = Object.fromEntries(
      Object.entries(input).filter(
        ([key]) => !['pattern', 'path'].includes(key),
      ),
    );
    body = (
      <>
        {(!known || ['Grep', 'Glob'].includes(block.name)) && (
          <details className="px-3.5 py-2">
            <summary>Tool input</summary>
            <pre className="m-0 overflow-x-auto rounded-none bg-page whitespace-pre-wrap font-mono text-small">
              {JSON.stringify(known ? options : block.input, null, 2)}
            </pre>
          </details>
        )}
        {results.map((result, index) => (
          <Result key={index} result={result} />
        ))}
      </>
    );
  }
  const waiting =
    block.name === 'AskUserQuestion' &&
    !results.length &&
    input.answers === undefined;
  return (
    <div
      id={toolAnchor(block.id)}
      className={`tool-card min-w-0 text-small ${variant === 'row' ? 'border-b border-line last:border-b-0' : waiting ? 'overflow-hidden rounded-xl border border-need-input/40 bg-need-input/6' : 'overflow-hidden rounded-xl border border-line bg-panel'}`}
    >
      {block.name === 'AskUserQuestion' ? (
        <QuestionCard
          input={input}
          results={results}
          compact={context.compact}
        />
      ) : (
        <>
          <div className="px-3.5">
            <ToolRow
              summary={summary}
              rawName={block.name}
              open={expanded}
              bodyId={id}
              toggle={() => setOpen(!expanded)}
              fixed={fixed}
              compact={context.compact}
              pathTitle={
                str('file_path') ||
                str('notebook_path') ||
                str('url') ||
                str('path') ||
                block.change?.filePath
              }
            >
              {block.name === 'Write' && block.change?.kind === 'create' && (
                <span className="shrink-0 rounded border border-line px-1.5 text-xs text-muted">
                  New file
                </span>
              )}
              {edit && !context.compact && (
                <SegmentedControl
                  label="Diff layout"
                  options={[
                    { value: 'unified', label: 'Unified' },
                    { value: 'split', label: 'Split' },
                  ]}
                  value={mode}
                  onValueChange={(value) =>
                    setMode(value === 'split' ? 'split' : 'unified')
                  }
                />
              )}
            </ToolRow>
          </div>
          {expanded && (
            <div
              id={id}
              className={
                variant === 'card' && block.name !== 'Bash' && !fixed
                  ? 'border-t border-line'
                  : ''
              }
            >
              {body}
            </div>
          )}
          {block.name === 'Bash' &&
            variant === 'card' &&
            context.compact &&
            !expanded &&
            results.length > 0 && (
              <p className="truncate bg-surface px-3.5 py-2 font-mono text-small text-muted">
                {results
                  .flatMap((result) => result.text.split('\n'))
                  .filter((line) => line.trim())
                  .at(-1)}
              </p>
            )}
        </>
      )}
      {(block.name === 'Task' || block.name === 'Agent') &&
        context.subagents
          ?.filter((agent) => agent.parentToolUseId === block.id)
          .map((agent) => (
            <div className="nested-subagent px-3.5 py-2" key={agent.agentId}>
              <button
                type="button"
                title="Transcript unavailable through this API."
                className="text-accent max-sm:min-h-11"
                onClick={() => context.openSubagent?.(agent.agentId)}
              >
                Subagent: <span>{agent.description ?? agent.agentId}</span>
                <span className="text-muted">
                  {' '}
                  · {agent.agentId.slice(0, 8)}
                </span>
              </button>
            </div>
          ))}
    </div>
  );
}

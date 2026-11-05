import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Message } from '@c9view/api';
import {
  ToolCard,
  Result,
  type ToolResult,
  type ToolContext,
} from '../tools/ToolCard.js';
import { Markdown } from '../markdown.js';
import { Empty } from '../ui.js';
import { classifyMessage } from './markup.js';
import { buildTurns } from './turns.js';
import { AssistantHeader } from './chat/AssistantHeader.js';
import { UserBubble } from './chat/UserBubble.js';
import { CommandChip } from './chat/CommandChip.js';
import { PastedText } from './chat/PastedText.js';
import { LocalOutput } from './chat/LocalOutput.js';
import { TaskNotice } from './chat/TaskNotice.js';
import { SystemNote } from './chat/SystemNote.js';
import { ThinkingFold } from './chat/ThinkingFold.js';
import { TurnDivider } from './chat/TurnDivider.js';
import { estimateRow } from './chat/estimate.js';
import { groupMessages, messageAnchor, summarizeGroup } from './model.js';
import { ToolGroup } from './ToolGroup.js';
import {
  ConversationEdge,
  type ConversationEdgeState,
} from './ConversationEdge.js';
import { WindowedMessages } from './WindowedMessages.js';

export function Conversation({
  messages,
  context = {},
  target,
  jumpVersion = 0,
  onJumpHandled,
  footer,
  edge,
  startAtBottom,
  onNearTop,
  isFetching,
  trailing = false,
  search,
}: {
  messages: Message[];
  search?: { term: string; active?: string | undefined };
  footer?: ReactNode;
  edge?: ConversationEdgeState;
  startAtBottom?: boolean;
  onNearTop?: () => void;
  isFetching?: boolean;
  trailing?: boolean;
  context?: ToolContext;
  target?: string | undefined;
  jumpVersion?: number;
  onJumpHandled?: (() => void) | undefined;
}) {
  const [showMeta, setShowMeta] = useState(false);
  const [revealedMeta, setRevealedMeta] = useState<string>();
  const [expandedGroups, setExpandedGroups] = useState(new Set<string>());
  useEffect(() => {
    if (!target) return;
    const message = messages.find(
      (m) =>
        m.uuid === target ||
        m.blocks.some((b) => b.type === 'tool_use' && b.id === target),
    );
    // This state must outlive the target prop: jump handling clears that prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRevealedMeta(message?.isMeta ? message.uuid : undefined);
  }, [target, jumpVersion, messages]);
  const revealToolId = context.revealToolId;
  const visible = useMemo(
    () =>
      messages.filter(
        (m) =>
          showMeta ||
          !m.isMeta ||
          m.uuid === target ||
          m.uuid === revealedMeta ||
          m.blocks.some(
            (b) => b.type === 'tool_use' && b.id === (revealToolId ?? target),
          ),
      ),
    [messages, showMeta, target, revealedMeta, revealToolId],
  );
  const toolIds = useMemo(
    () =>
      new Set(
        visible.flatMap((m) =>
          m.blocks.flatMap((b) => (b.type === 'tool_use' ? [b.id] : [])),
        ),
      ),
    [visible],
  );
  const results = new Map<string, ToolResult[]>();
  for (const message of visible)
    for (const block of message.blocks)
      if (block.type === 'tool_result')
        results.set(block.toolUseId, [
          ...(results.get(block.toolUseId) ?? []),
          block,
        ]);
  const timing = useMemo(() => {
    const callAt = new Map<string, string | null>();
    const resultAt = new Map<string, string | null>();
    for (const message of messages) {
      for (const block of message.blocks) {
        if (block.type === 'tool_use') callAt.set(block.id, message.timestamp);
        if (block.type === 'tool_result' && !resultAt.has(block.toolUseId))
          resultAt.set(block.toolUseId, message.timestamp);
      }
    }
    return { callAt, resultAt };
  }, [messages]);
  const { turns, thinkingDurations, thinkingTokens } = useMemo(
    () => buildTurns(messages),
    [messages],
  );
  const displayedBlocks = useCallback(
    (message: Message) =>
      message.blocks.filter(
        (block) =>
          block.type !== 'tool_result' || !toolIds.has(block.toolUseId),
      ),
    [toolIds],
  );
  const renders = useCallback(
    (message: Message) => {
      if (message.truncated) return true;
      if (!displayedBlocks(message).length) return false;
      if (message.role === 'assistant') return true;
      return (
        classifyMessage(message).segments.length > 0 ||
        displayedBlocks(message).some((block) => block.type !== 'text')
      );
    },
    [displayedBlocks],
  );
  const visibleIds = useMemo(
    () => new Set(visible.filter(renders).map((message) => message.uuid)),
    [visible, renders],
  );
  // Keep the original group's first UUID as the windowing key even when its
  // first message is hidden; revealing system messages must not replace rows.
  const groups = useMemo(
    () =>
      groupMessages(messages).filter((group) =>
        group.some((message) => visibleIds.has(message.uuid)),
      ),
    [messages, visibleIds],
  );
  // WindowedMessages invokes render again while scrolling. Reuse these arrays
  // so an expanded group's nested jump effect keeps the same group identities.
  const displayedGroups = useMemo(
    () =>
      new Map(
        groups.map((group) => [
          group[0]!.uuid,
          group.filter((message) => visibleIds.has(message.uuid)),
        ]),
      ),
    [groups, visibleIds],
  );
  const headerIds = useMemo(() => {
    const ids = new Set<string>();
    let previous: Message | undefined;
    for (const message of visible) {
      if (!visibleIds.has(message.uuid)) continue;
      if (
        message.role === 'assistant' &&
        (previous?.role !== 'assistant' || previous.model !== message.model)
      )
        ids.add(message.uuid);
      previous = message;
    }
    return ids;
  }, [visible, visibleIds]);
  const dividerRows = useMemo(() => {
    const rowsByMessage = new Map<string, string>();
    for (const group of groups)
      for (const message of group)
        rowsByMessage.set(message.uuid, group[0]!.uuid);
    const dividers = new Map<string, (typeof turns)[number]>();
    for (let index = 1; index < turns.length; index++) {
      if (!turns[index - 1]!.requests) continue;
      const rowKey = rowsByMessage.get(turns[index]!.startId);
      if (rowKey) dividers.set(rowKey, turns[index - 1]!);
    }
    return dividers;
  }, [groups, turns]);
  const estimate = useCallback(
    (group: Message[]) =>
      estimateRow(
        displayedGroups.get(group[0]!.uuid)!,
        dividerRows.has(group[0]!.uuid),
        {
          compact: context.compact,
          openChange: !!context.openChange,
          startsAssistant: group.some((message) => headerIds.has(message.uuid)),
        },
      ),
    [
      displayedGroups,
      dividerRows,
      context.compact,
      context.openChange,
      headerIds,
    ],
  );
  const markdown = (text: string) => <Markdown text={text} />;
  function renderMessage(
    message: Message,
    inGroup = false,
    suppressHeader = false,
  ) {
    const blocks = displayedBlocks(message);
    const { kind, segments } = classifyMessage(message);
    const parsed = segments.map((segment, index) => {
      switch (segment.kind) {
        case 'text':
          return <Fragment key={index}>{markdown(segment.text)}</Fragment>;
        case 'note':
          return <span key={index}>{segment.text}</span>;
        case 'pasted':
          return (
            <PastedText
              key={index}
              text={segment.text}
              lines={segment.lines}
              reveal={
                !!search?.term &&
                message.uuid === search.active &&
                segment.text.toLocaleLowerCase().includes(search.term)
              }
            />
          );
        case 'command':
          return (
            <CommandChip
              key={index}
              name={segment.name}
              args={segment.args}
              timestamp={message.timestamp}
            />
          );
        case 'stdout':
          return (
            <LocalOutput
              key={index}
              text={segment.text}
              lines={segment.lines}
              timestamp={message.timestamp}
            />
          );
        case 'task':
          return (
            <TaskNotice
              key={index}
              status={segment.status}
              summary={segment.summary}
            />
          );
      }
    });
    let seenThinking = false;
    const body = blocks.map((block, index) => {
      switch (block.type) {
        case 'text':
          return <Fragment key={index}>{markdown(block.text)}</Fragment>;
        case 'thinking': {
          const tokens = seenThinking
            ? 0
            : (thinkingTokens.get(message.uuid) ?? 0);
          seenThinking = true;
          return (
            <div
              key={index}
              className={
                inGroup ? 'border-b border-line px-3.5 py-1.5' : undefined
              }
            >
              <ThinkingFold
                key={index}
                text={block.text}
                milliseconds={thinkingDurations.get(message.uuid)}
                tokens={tokens}
              />
            </div>
          );
        }
        case 'image':
          return (
            <p key={index} className="text-xs text-muted">
              [Image attachment]
            </p>
          );
        case 'tool_result':
          return <Result key={index} result={block} />;
        case 'tool_use':
          return (
            <ToolCard
              key={index}
              block={block}
              context={{
                ...context,
                revealToolId:
                  context.revealToolId ??
                  (message.blocks.some(
                    (b) => b.type === 'tool_use' && b.id === target,
                  )
                    ? target
                    : undefined),
              }}
              variant={inGroup ? 'row' : 'card'}
              timing={{
                callAt: timing.callAt.get(block.id),
                resultAt: timing.resultAt.get(block.id),
              }}
              results={results.get(block.id)}
            />
          );
      }
    });
    return (
      <article
        id={messageAnchor(message.uuid)}
        tabIndex={-1}
        className={`relative min-w-0 ${inGroup ? '' : 'space-y-2.5'} ${message.role === 'assistant' && !inGroup ? 'pl-11' : ''} ${kind === 'prompt' ? 'ml-auto' : ''}`}
      >
        {message.truncated && (
          <SystemNote>
            <p role="note">This message was cut to fit the page size.</p>
          </SystemNote>
        )}
        {message.role === 'assistant' &&
        (kind === 'note' || kind === 'task-notification') &&
        !blocks.some((block) => block.type !== 'text') ? (
          <SystemNote>
            {parsed}
            {body.filter((_, index) => blocks[index]?.type !== 'text')}
          </SystemNote>
        ) : message.role === 'assistant' ? (
          <>
            {(kind === 'note' || kind === 'task-notification') && (
              <SystemNote>{parsed}</SystemNote>
            )}
            {headerIds.has(message.uuid) && !suppressHeader && (
              <AssistantHeader message={message} />
            )}
            {kind === 'note' || kind === 'task-notification'
              ? body.filter((_, index) => blocks[index]?.type !== 'text')
              : body}
          </>
        ) : message.isMeta || kind === 'note' || kind === 'other' ? (
          <SystemNote meta={message.isMeta}>
            {parsed}
            {blocks.filter((block) => block.type !== 'text').length > 0 &&
              body.filter((_, index) => blocks[index]?.type !== 'text')}
          </SystemNote>
        ) : kind === 'prompt' ? (
          <UserBubble timestamp={message.timestamp}>
            {parsed}
            {blocks.some((block) => block.type === 'image') && (
              <p className="text-xs text-muted">[Image attachment]</p>
            )}
          </UserBubble>
        ) : (
          parsed
        )}
      </article>
    );
  }
  const requestedTarget = target ?? context.revealToolId;
  const targetMessage = messages.find((m) => m.uuid === requestedTarget);
  const pairedResult = targetMessage?.blocks.find(
    (b) => b.type === 'tool_result' && toolIds.has(b.toolUseId),
  );
  const jumpTarget =
    targetMessage?.blocks.every((b) => b.type === 'tool_result') &&
    pairedResult?.type === 'tool_result'
      ? pairedResult.toolUseId
      : requestedTarget;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <label className="flex flex-none items-center justify-end gap-2 text-xs text-muted max-sm:min-h-11">
        <input
          type="checkbox"
          checked={showMeta}
          onChange={(e) => {
            setShowMeta(e.target.checked);
            setRevealedMeta(undefined);
          }}
        />
        Show system messages
      </label>
      {!visible.length && !edge?.hasEarlier && (
        <Empty>No messages to display.</Empty>
      )}
      <WindowedMessages
        header={edge && <ConversationEdge {...edge} />}
        startAtBottom={startAtBottom ?? false}
        onNearTop={onNearTop}
        isFetching={isFetching ?? false}
        onJumpHandled={onJumpHandled}
        jumpVersion={jumpVersion}
        groups={groups}
        enabled={messages.length > 300}
        target={jumpTarget}
        estimate={estimate}
        footer={
          <>
            {trailing && turns.at(-1) && <TurnDivider turn={turns.at(-1)!} />}
            {footer}
          </>
        }
        render={(group) => {
          const displayed = displayedGroups.get(group[0]!.uuid)!;
          const headerMessage = displayed.find((message) =>
            headerIds.has(message.uuid),
          );
          const divider = dividerRows.get(group[0]!.uuid);
          const interaction = displayed.some((message) =>
            message.blocks.some(
              (block) =>
                block.type === 'tool_use' &&
                [
                  'AskUserQuestion',
                  'ExitPlanMode',
                  'EnterPlanMode',
                  'plan',
                ].includes(block.name),
            ),
          );
          const grouped =
            !interaction &&
            !displayed.some((message) =>
              message.blocks.some((block) => block.type === 'text'),
            ) &&
            displayed.reduce(
              (count, message) =>
                count +
                message.blocks.filter((block) => block.type === 'tool_use')
                  .length,
              0,
            ) >= 2;
          return (
            <>
              {divider && <TurnDivider turn={divider} />}
              {!grouped ? (
                displayed.map((message) => (
                  <Fragment key={message.uuid}>
                    {renderMessage(message)}
                  </Fragment>
                ))
              ) : (
                <div className="relative min-w-0 space-y-2.5 pl-11">
                  {headerMessage && <AssistantHeader message={headerMessage} />}
                  <ToolGroup
                    jumpVersion={jumpVersion}
                    summary={summarizeGroup(displayed, timing.resultAt)}
                    compact={context.compact}
                    openChange={!!context.openChange}
                    expanded={expandedGroups.has(group[0]!.uuid)}
                    toggle={() =>
                      setExpandedGroups((previous) => {
                        const next = new Set(previous);
                        const key = group[0]!.uuid;
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    messages={displayed}
                    target={jumpTarget}
                    render={(message) =>
                      renderMessage(
                        message,
                        true,
                        message.uuid === headerMessage?.uuid,
                      )
                    }
                  />
                </div>
              )}
            </>
          );
        }}
      />
    </div>
  );
}

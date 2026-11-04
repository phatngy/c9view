import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { displayToolName, type ToolSummary } from './summary.js';
export function ToolRow({
  summary,
  rawName,
  open,
  bodyId,
  toggle,
  fixed = false,
  compact = false,
  pathTitle,
  children,
}: {
  summary: ToolSummary;
  rawName: string;
  open: boolean;
  bodyId: string;
  toggle: () => void;
  fixed?: boolean;
  compact?: boolean | undefined;
  pathTitle?: string | undefined;
  children?: ReactNode;
}) {
  const badgeId = useId();
  const Icon = summary.icon;
  const server = displayToolName(rawName).server;
  const tone =
    summary.tone === 'run'
      ? summary.badge?.tone === 'danger'
        ? 'text-danger'
        : 'text-success'
      : (
          {
            search: 'text-in-progress',
            edit: 'text-in-review',
            plan: 'text-in-review',
            ask: 'text-need-input',
            muted: 'text-muted',
          } as const
        )[summary.tone];
  const linked = summary.summary.find((item) => item.href);
  const contents = (
    <>
      {!fixed && (
        <ChevronRight
          aria-hidden
          size={14}
          className={`shrink-0 text-muted motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}
        />
      )}
      <Icon aria-hidden size={15} className={`shrink-0 ${tone}`} />
      {server && <span className="text-muted">{server}</span>}
      <span className={`shrink-0 font-medium ${compact ? '' : 'w-12'}`}>
        {summary.name}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {summary.summary
          .filter((item) => !item.href)
          .map((item, index) => (
            <span
              key={index}
              title={pathTitle}
              className={item.mono ? 'font-mono text-small' : ''}
            >
              {item.text}
            </span>
          ))}
      </span>
    </>
  );
  return (
    <div className="flex min-h-10 items-center gap-2.5 max-sm:min-h-12!">
      {fixed ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {contents}
        </div>
      ) : (
        <button
          type="button"
          aria-label={`${summary.name} ${summary.summary.map((item) => item.text).join(' ')}`.trim()}
          aria-describedby={summary.badge ? badgeId : undefined}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
          className={`flex min-h-10 min-w-0 items-center gap-2.5 rounded-none border-0 bg-transparent p-0 text-left hover:bg-transparent max-sm:min-h-12! focus-visible:outline-2 focus-visible:outline-accent ${linked ? 'shrink-0' : 'flex-1'}`}
        >
          {contents}
        </button>
      )}
      {linked && (
        <a
          className="min-w-0 flex-1 truncate font-mono text-small text-accent underline"
          href={linked.href}
          title={pathTitle || linked.text}
        >
          {linked.text}
        </a>
      )}
      {summary.detail && (
        <span className="hidden shrink truncate text-muted sm:inline">
          {summary.detail}
        </span>
      )}
      <span className="ml-auto shrink-0">
        {summary.diff ? (
          <span className="inline-flex gap-1 font-mono text-small">
            <span aria-hidden className="text-success">
              +{summary.diff.additions}
            </span>
            <span aria-hidden className="text-danger">
              −{summary.diff.deletions}
            </span>
            <span className="sr-only">
              {summary.diff.additions} additions, {summary.diff.deletions}{' '}
              deletions
            </span>
          </span>
        ) : (
          summary.badge && (
            <span
              id={badgeId}
              className={`inline-flex items-center gap-1.5 ${{ muted: 'text-muted', success: 'text-success', danger: 'text-danger', accent: 'text-accent' }[summary.badge.tone]}`}
            >
              {rawName === 'Bash' && (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-current"
                />
              )}
              {summary.badge.text}
            </span>
          )
        )}
      </span>
      {children}
    </div>
  );
}

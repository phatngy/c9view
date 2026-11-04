import { DiffView } from '../diff/DiffView.js';
import type { ToolContext, ToolUse } from './ToolCard.js';
export function EditBody({
  block,
  context,
  mode,
}: {
  block: ToolUse;
  context: ToolContext;
  mode: 'unified' | 'split';
}) {
  return block.change ? (
    <>
      <div className="mx-3.5 mb-3.5 overflow-hidden rounded-lg border border-line">
        <DiffView {...block.change} bare mode={mode} />
      </div>
      {context.openChange && (
        <button
          type="button"
          className="mx-3.5 mb-3 text-accent max-sm:min-h-11"
          onClick={() => context.openChange?.(block.id)}
        >
          {block.change.truncated
            ? 'Truncated — open full diff in Files changed'
            : 'Open in Files changed'}
        </button>
      )}
    </>
  ) : (
    <p className="px-3.5 py-2 text-muted">
      Diff unavailable for this tool call.
    </p>
  );
}

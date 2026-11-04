import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../kit/index.js';
import type { DiffHunk } from '@c9view/api';
import { useDiffMode } from './mode.js';
import { buildRows, foldRows, type Cell } from './rows.js';
import { CodeLine, languageFor } from './highlight.js';
import { useContainerHeight, useWindowedRows } from './useWindowedRows.js';

function DiffCell({
  cell,
  language,
  side,
}: {
  cell?: Cell | undefined;
  language: string;
  side?: 'old' | 'new';
}) {
  if (!cell)
    return (
      <>
        <td className="line-number" />
        <td />
      </>
    );
  return (
    <>
      {side ? (
        <td className="line-number">{side === 'old' ? cell.old : cell.new}</td>
      ) : (
        <>
          <td className="line-number">{cell.old}</td>
          <td className="line-number">{cell.new}</td>
        </>
      )}
      <td
        className={`diff-code ${cell.kind}`}
        aria-label={`${cell.kind === 'added' ? 'Added' : cell.kind === 'removed' ? 'Removed' : 'Context'} line ${cell.new ?? cell.old ?? ''}${cell.noNewline ? ', no newline at end of file' : ''}`}
      >
        <span aria-hidden="true">
          {cell.kind === 'added'
            ? '+'
            : cell.kind === 'removed'
              ? '−'
              : ' '}{' '}
        </span>
        <CodeLine text={cell.text} language={language} />
        {cell.noNewline && (
          <span className="badge ml-2" aria-label="No newline at end of file">
            no newline
          </span>
        )}
      </td>
    </>
  );
}
export interface DiffViewProps {
  filePath: string;
  hunks: DiffHunk[];
  kind?: 'create' | 'update' | 'delete' | 'rename' | undefined;
  additions?: number;
  deletions?: number;
  truncated?: boolean;
  tooLarge?: boolean;
  partial?: boolean;
  bare?: boolean;
  mode?: 'unified' | 'split';
}
export function DiffView(props: DiffViewProps) {
  const [sharedMode, setMode] = useDiffMode();
  const mode = props.mode ?? sharedMode;
  const [wide, setWide] = useState(
    () => window.matchMedia?.('(min-width: 768px)').matches ?? false,
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 768px)');
    const change = () => setWide(media?.matches ?? false);
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, []);
  const built = useMemo(() => buildRows(props.hunks), [props.hunks]);
  const split = mode === 'split' && wide;
  const folded = useMemo(
    () => foldRows(split ? built.split : built.unified),
    [built, split],
  );
  const rows = useMemo(
    () =>
      folded.flatMap((row) =>
        row.kind === 'fold' && expanded.has(row.foldKey) ? row.rows : [row],
      ),
    [folded, expanded],
  );
  const virtual = rows.length > 1000;
  const scroll = useRef<HTMLDivElement>(null);
  const viewportHeight = useContainerHeight(scroll);
  const windowed = useWindowedRows(rows.length, {
    enabled: virtual,
    viewportHeight,
  });
  const columns = split ? 4 : 3;
  const language = languageFor(props.filePath);
  return (
    <section
      className="diff-view min-w-0"
      aria-label={`Diff for ${props.filePath}`}
    >
      {!props.bare && (
        <header className="flex flex-wrap items-center gap-2 p-2 text-xs">
          <strong className="min-w-0 break-all">{props.filePath}</strong>
          {props.kind && <span className="badge">{props.kind}</span>}
          <span className="text-success">
            +{props.additions ?? built.additions}
          </span>
          <span className="text-danger">
            −{props.deletions ?? built.deletions}
          </span>
          <button
            type="button"
            className="ml-auto max-sm:min-h-11"
            onClick={() => {
              const next = mode === 'unified' ? 'split' : 'unified';
              setMode(next);
            }}
            aria-label={`Diff mode: ${mode}. Switch to ${mode === 'unified' ? 'split' : 'unified'}`}
          >
            {mode === 'unified' ? 'Split' : 'Unified'}
          </button>
        </header>
      )}
      {mode === 'split' && !wide && (
        <p className="p-2 text-xs text-muted">Unified view on small screens</p>
      )}
      {props.truncated && (
        <p role="note">Truncated diff. Some changes are omitted.</p>
      )}
      {props.tooLarge && <p role="note">This diff is too large to display.</p>}
      {props.partial && (
        <p role="note">Partial diff: complete file history is unavailable.</p>
      )}
      <div
        ref={scroll}
        className="code-scroll"
        tabIndex={0}
        role="region"
        aria-label="Diff contents"
        style={virtual ? { height: '75vh', maxHeight: 600 } : undefined}
        onScroll={windowed.onScroll}
      >
        <table
          className="diff-table"
          aria-label={`${split ? 'Split' : 'Unified'} diff`}
        >
          <tbody>
            {virtual && windowed.top > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns}
                  style={{ height: windowed.top, padding: 0 }}
                />
              </tr>
            )}
            {rows.slice(windowed.start, windowed.end).map((row, index) => (
              <tr
                key={row.id}
                ref={index === 0 && virtual ? windowed.measureRow : undefined}
                style={{ height: windowed.rowHeight }}
              >
                {row.kind === 'fold' ? (
                  <td colSpan={columns}>
                    <button
                      className="fold-button"
                      onClick={() =>
                        setExpanded((previous) =>
                          new Set(previous).add(row.foldKey),
                        )
                      }
                    >
                      Show {row.count} lines
                    </button>
                  </td>
                ) : row.kind === 'hunk' ? (
                  <td colSpan={columns} className="text-muted">
                    {row.label}
                  </td>
                ) : split ? (
                  <>
                    <DiffCell cell={row.left} language={language} side="old" />
                    <DiffCell cell={row.right} language={language} side="new" />
                  </>
                ) : (
                  <DiffCell cell={row.left} language={language} />
                )}
              </tr>
            ))}
            {virtual && windowed.end < rows.length && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns}
                  style={{ height: windowed.bottom, padding: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!props.hunks.length && !props.tooLarge && (
        <EmptyState compact title="No text diff available." />
      )}
    </section>
  );
}

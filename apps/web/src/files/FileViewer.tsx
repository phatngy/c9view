import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../kit/index.js';
import type { FileContentResponse } from '@c9view/api';
import { CodeLine } from '../diff/highlight.js';
import {
  useContainerHeight,
  useWindowedRows,
} from '../diff/useWindowedRows.js';

export function parseLineRange(anchor: string) {
  const match = /^(?:#)?L?(\d+)(?:-L?(\d+))?$/.exec(anchor);
  if (!match) return undefined;
  const start = Math.max(1, Number(match[1]));
  return { start, end: Math.max(start, Number(match[2] ?? start)) };
}
export function FileViewer({
  file,
  line,
  denied,
}: {
  file?: FileContentResponse | undefined;
  line?: string | undefined;
  denied?: string;
}) {
  const [hash, setHash] = useState(window.location.hash);
  const [copied, setCopied] = useState(false);
  const selected = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const currentPath = useRef(file?.path);
  const lastScrolledKey = useRef<string | undefined>(undefined);
  const lines = useMemo(
    () => (file?.content ?? '').split('\n'),
    [file?.content],
  );
  const virtual = lines.length > 1000;
  const viewportHeight = useContainerHeight(scroll);
  const windowed = useWindowedRows(lines.length, {
    enabled: virtual,
    viewportHeight,
  });
  const scrollToIndex = useRef(windowed.scrollToIndex);
  const virtualMode = useRef(virtual);
  const range = parseLineRange(hash) ?? parseLineRange(line ?? '');
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (currentPath.current !== file?.path) {
      currentPath.current = file?.path;
      setHash('');
      if (window.location.hash) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }
  }, [file?.path]);
  useEffect(() => {
    scrollToIndex.current = windowed.scrollToIndex;
    virtualMode.current = virtual;
  }, [virtual, windowed.scrollToIndex]);
  useEffect(() => {
    const key = JSON.stringify([file?.path, range?.start, range?.end]);
    if (lastScrolledKey.current === key) return;
    lastScrolledKey.current = key;
    if (!range?.start) return;
    const container = scroll.current;
    if (virtualMode.current) {
      scrollToIndex.current(range.start - 1, container);
    } else if (container && selected.current) {
      container.scrollTop =
        selected.current.offsetTop -
        container.clientHeight / 2 +
        selected.current.offsetHeight / 2;
    }
  }, [file?.path, range?.start, range?.end]);
  if (denied)
    return (
      <p role="note" className="panel">
        🔒 {denied}
      </p>
    );
  if (!file)
    return <EmptyState compact title="Choose a file to view its contents." />;
  return (
    <section className="min-w-0" aria-label={`File ${file.path}`}>
      <header className="flex flex-wrap items-center gap-2 py-2 text-xs">
        <strong className="break-all font-mono text-small">{file.path}</strong>
        <span>{file.size.toLocaleString()} bytes</span>
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(file.path)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? 'Copied' : 'Copy path'}
        </button>
      </header>
      {file.binary ? (
        <p role="note">
          Binary file ({file.language}); content is unavailable.
        </p>
      ) : file.tooLarge || file.notice === 'too-large' ? (
        <p role="note">
          File is too large to display ({file.size.toLocaleString()} bytes).
        </p>
      ) : (
        <div
          ref={scroll}
          className="code-scroll file-content"
          role="list"
          aria-label="File lines"
          onScroll={windowed.onScroll}
        >
          {virtual && windowed.top > 0 && (
            <div aria-hidden="true" style={{ height: windowed.top }} />
          )}
          {lines.slice(windowed.start, windowed.end).map((text, index) => {
            const lineIndex = windowed.start + index;
            const n = lineIndex + 1,
              active = !!range && n >= range.start && n <= range.end;
            return (
              <div
                role="listitem"
                id={`L${n}`}
                key={n}
                ref={(node) => {
                  if (index === 0 && virtual) windowed.measureRow(node);
                  if (n === range?.start) selected.current = node;
                }}
                className={`file-line ${active ? 'selected-line' : ''}`}
                aria-label={`Line ${n}${active ? ', selected' : ''}`}
              >
                <a className="line-number" href={`#L${n}`}>
                  {n}
                </a>
                <CodeLine text={text} language={file.language} />
              </div>
            );
          })}
          {virtual && windowed.bottom > 0 && (
            <div aria-hidden="true" style={{ height: windowed.bottom }} />
          )}
        </div>
      )}
    </section>
  );
}

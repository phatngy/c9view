import type { ReactNode } from 'react';

export function Highlights({
  text,
  ranges,
}: {
  text: string;
  ranges: [number, number][];
}) {
  const merged: [number, number][] = [];
  for (const [start, end] of ranges
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && b > a)
    .map(([a, b]): [number, number] => [
      Math.max(0, a),
      Math.min(text.length, b),
    ])
    .sort((a, b) => a[0] - b[0])) {
    if (end <= start) continue;
    const previous = merged.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  const decorative = (value: string) =>
    value.split('…').flatMap((part, index) =>
      index
        ? [
            <span key={index} aria-hidden="true">
              …
            </span>,
            part,
          ]
        : [part],
    );
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    parts.push(
      decorative(text.slice(cursor, start)),
      <mark key={start}>{decorative(text.slice(start, end))}</mark>,
    );
    cursor = end;
  }
  parts.push(decorative(text.slice(cursor)));
  return <>{parts}</>;
}

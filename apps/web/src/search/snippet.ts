interface Snippet {
  snippet: string;
  highlights: [number, number][];
  cutStart?: boolean;
  cutEnd?: boolean;
}

// Claude Code uses kebab-case markup plus these single-word wrapper tags.
// Ordinary HTML and type parameters are intentionally left as source text.
const tagName = '(?:[a-z]+(?:-[a-z]+)+|status|summary|result|usage|thinking)';
const attributes = `(?:\\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\\s*`;
const whitespace = (text: string) => /^\s+$/.test(text);

export function cleanSnippet({
  snippet,
  highlights,
  cutStart = false,
  cutEnd = false,
}: Snippet): Pick<Snippet, 'snippet' | 'highlights'> {
  const ranges = highlights.filter(
    ([start, end]) =>
      Number.isInteger(start) && Number.isInteger(end) && end > start,
  );
  const removed = new Set<number>();
  const remove = (start: number, end: number) => {
    for (let i = start; i < end; i++) removed.add(i);
  };
  for (const tag of snippet.matchAll(
    new RegExp(`<\\/?${tagName}${attributes}\\/?>`, 'g'),
  ))
    remove(tag.index, tag.index + tag[0].length);
  if (cutStart) {
    const fragment = snippet.match(/^[^<\s]*>/)?.[0];
    // A cut tag tail must retain a kebab-name part, a known wrapper suffix,
    // or attribute syntax. Do not consume arbitrary comparison operands.
    const tail = fragment?.replace(/^\/|\/?>$/g, '');
    const knownTail =
      tail &&
      tail.length >= 3 &&
      [
        'teammate-message',
        'system-reminder',
        'command-name',
        'local-command-stdout',
        'local-command-stderr',
        'status',
        'summary',
        'result',
        'usage',
        'thinking',
      ].some((name) => name.endsWith(tail));
    if (
      fragment &&
      (knownTail ||
        /^(?:\/?[a-z]+(?:-[a-z]+)+\/?|(?:status|summary|result|usage|thinking)|[^<>\s]*[="'][^<>\s]*)>$/.test(
          fragment,
        ))
    )
      remove(0, fragment.length);
  }
  if (cutEnd) {
    const fragment = snippet.match(
      new RegExp(`<\\/?${tagName}(?=\\s|$)[^<>]*$`),
    );
    if (fragment) remove(fragment.index!, snippet.length);
  }
  const units: { text: string; sources: number[] }[] = [];
  for (let i = 0; i < snippet.length; i++) {
    if (removed.has(i)) continue;
    const text = snippet[i]!;
    const previous = units.at(-1);
    if (whitespace(text) && previous && whitespace(previous.text)) {
      previous.text += text;
      previous.sources.push(i);
    } else units.push({ text, sources: [i] });
  }
  // Tags are transparent to whitespace runs, but never contribute matches.
  for (const unit of units) {
    if (!whitespace(unit.text)) continue;
    const newlines = unit.text.match(/\n/g)?.length ?? 0;
    unit.text = newlines ? '\n'.repeat(Math.min(2, newlines)) : ' ';
  }
  const trim = () => {
    while (units[0] && whitespace(units[0].text)) units.shift();
    while (units.at(-1) && whitespace(units.at(-1)!.text)) units.pop();
  };
  trim();
  const marked = (sources: number[]) =>
    ranges.some(([start, end]) =>
      sources.some((index) => index >= start && index < end),
    );
  // Preserve edge words containing a match, even if the server cut them.
  if (cutStart && !removed.has(0) && /^[\p{L}\p{N}_]/u.test(snippet)) {
    let end = 0;
    while (end < units.length && !whitespace(units[end]!.text)) end++;
    if (!units.slice(0, end).some((unit) => marked(unit.sources)))
      units.splice(0, end);
  }
  if (
    cutEnd &&
    !removed.has(snippet.length - 1) &&
    /[\p{L}\p{N}_]$/u.test(snippet)
  ) {
    let start = units.length;
    while (start > 0 && /[\p{L}\p{N}_]/u.test(units[start - 1]!.text)) start--;
    if (!units.slice(start).some((unit) => marked(unit.sources)))
      units.splice(start);
  }
  trim();
  if (!units.length)
    return { snippet: cutStart || cutEnd ? '…' : '', highlights: [] };
  const prefix = cutStart ? '…' : '';
  let offset = prefix.length;
  const positioned = units.map((unit) => {
    const start = offset;
    offset += unit.text.length;
    return { ...unit, start, end: offset };
  });
  const remapped: [number, number][] = [];
  for (const [start, end] of ranges) {
    const matched = positioned.filter((unit) =>
      unit.sources.some((source) => source >= start && source < end),
    );
    if (matched.length) remapped.push([matched[0]!.start, matched.at(-1)!.end]);
  }
  const merged: [number, number][] = [];
  for (const [start, end] of remapped.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return {
    snippet:
      prefix + units.map((unit) => unit.text).join('') + (cutEnd ? '…' : ''),
    highlights: merged,
  };
}

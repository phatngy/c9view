import type { DiffHunk } from '@c9view/api';
export interface Cell {
  text: string;
  old?: number;
  new?: number;
  kind: 'context' | 'added' | 'removed' | 'notice';
  noNewline?: boolean;
}
export interface DiffRow {
  id: number;
  kind: Cell['kind'] | 'hunk' | 'change';
  left?: Cell | undefined;
  right?: Cell | undefined;
  label?: string;
}
/** Each patch line is visited once; pending replacement runs are paired in linear time. */
export function buildRows(hunks: DiffHunk[]) {
  const unified: DiffRow[] = [],
    split: DiffRow[] = [];
  let additions = 0,
    deletions = 0,
    id = 0;
  for (const hunk of hunks) {
    let old = hunk.oldStart,
      next = hunk.newStart;
    let removed: Cell[] = [],
      added: Cell[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(removed.length, added.length); i++)
        split.push({
          id: id++,
          kind: 'change',
          left: removed[i],
          right: added[i],
        });
      removed = [];
      added = [];
    };
    const heading: DiffRow = {
      id: id++,
      kind: 'hunk',
      label: `@@ -${old},${hunk.oldLines} +${next},${hunk.newLines} @@`,
    };
    unified.push(heading);
    split.push(heading);
    for (const line of hunk.lines) {
      const prefix = line[0];
      let cell: Cell;
      if (prefix === '-') {
        cell = { kind: 'removed', text: line.slice(1), old: old++ };
        deletions++;
        removed.push(cell);
      } else if (prefix === '+') {
        cell = { kind: 'added', text: line.slice(1), new: next++ };
        additions++;
        added.push(cell);
      } else {
        if (prefix === '\\') {
          const previous = added.at(-1) ?? removed.at(-1);
          if (previous) previous.noNewline = true;
          else {
            const prior = unified.at(-1)?.left;
            if (prior && prior.kind !== 'notice') prior.noNewline = true;
            else {
              cell = { kind: 'notice', text: line };
              flush();
              split.push({ id: id++, kind: cell.kind, left: cell, right: cell });
              unified.push({ id: id++, kind: cell.kind, left: cell });
              continue;
            }
          }
          continue;
        }
        flush();
        cell = { kind: 'context', text: line.slice(1), old: old++, new: next++ };
        split.push({ id: id++, kind: cell.kind, left: cell, right: cell });
      }
      unified.push({ id: id++, kind: cell.kind, left: cell });
    }
    flush();
  }
  return { unified, split, additions, deletions };
}
export type FoldRow =
  | DiffRow
  | { id: number; foldKey: string; kind: 'fold'; count: number; rows: DiffRow[] };
export function foldRows(rows: DiffRow[]): FoldRow[] {
  const result: FoldRow[] = [];
  let hunkIndex = -1;
  for (let i = 0; i < rows.length;) {
    if (rows[i]!.kind === 'hunk') hunkIndex++;
    if (rows[i]!.kind !== 'context') {
      result.push(rows[i++]!);
      continue;
    }
    const start = i;
    while (i < rows.length && rows[i]!.kind === 'context') i++;
    const count = i - start;
    if (count <= 8) result.push(...rows.slice(start, i));
    else {
      result.push(...rows.slice(start, start + 3));
      result.push({
        id: rows[start + 3]!.id,
        foldKey: `${hunkIndex}:${rows[start + 3]!.left?.old ?? rows[start + 3]!.left?.new ?? ''}`,
        kind: 'fold',
        count: count - 6,
        rows: rows.slice(start + 3, i - 3),
      });
      result.push(...rows.slice(i - 3, i));
    }
  }
  return result;
}

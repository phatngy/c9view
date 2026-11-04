import { obj, str } from './tools.js';

/** NotebookEdit operates on cell source, rather than replacing the notebook. */
export function notebookAfter(
  before: string,
  input: Record<string, unknown>,
): string | undefined {
  try {
    const notebook = obj(JSON.parse(before));
    if (!Array.isArray(notebook.cells)) return undefined;
    const cells = notebook.cells.map(obj);
    const id = str(input.cell_id);
    const index = id
      ? cells.findIndex((cell) => cell.id === id)
      : typeof input.cell_number === 'number'
        ? input.cell_number
        : 0;
    const source = str(input.new_source).match(/[^\n]*\n|[^\n]+$/g) ?? [];
    if (input.edit_mode === 'insert') {
      cells.splice(id ? index + 1 : 0, 0, {
        cell_type: str(input.cell_type) || 'code',
        metadata: {},
        source,
      });
    } else {
      const cell = cells[index];
      if (!cell) return undefined;
      if (input.edit_mode === 'delete') cells.splice(index, 1);
      else cell.source = source;
    }
    notebook.cells = cells;
    const indent = /\n([ \t]+)"/.exec(before)?.[1];
    return (
      JSON.stringify(notebook, null, indent) +
      (before.endsWith('\n') ? '\n' : '')
    );
  } catch {
    return undefined;
  }
}

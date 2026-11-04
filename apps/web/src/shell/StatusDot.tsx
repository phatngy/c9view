import type { KanbanColumn } from '@c9view/api';

export function StatusDot({ column }: { column: KanbanColumn }) {
  return (
    <span
      aria-hidden="true"
      className="shell-status-dot"
      data-column={column}
    />
  );
}

import type { KanbanColumn, SessionSummary } from '@c9view/api';
import { total } from '../ui.js';

export const boardColumns: KanbanColumn[] = [
  'need_input',
  'in_progress',
  'in_review',
  'inactive',
];
export const sortFields = [
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
  { value: 'model', label: 'Model' },
  { value: 'branch', label: 'Branch' },
  { value: 'activity', label: 'Last activity' },
  { value: 'messages', label: 'Messages' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: '≈ Cost' },
] as const;
export const sortOptions = sortFields.flatMap(({ value, label }) => [
  { value: `${value}-asc`, label: `${label} · ascending` },
  { value: `${value}-desc`, label: `${label} · descending` },
]);
export function selectSessions(
  sessions: SessionSummary[],
  filter: string,
  sort: string,
) {
  const needle = filter.trim().toLocaleLowerCase();
  const [field, direction] = sort.split('-');
  const value = (session: SessionSummary): string | number => {
    switch (field) {
      case 'title':
        return session.title.toLocaleLowerCase();
      case 'status':
        return boardColumns.indexOf(session.status.column);
      case 'model':
        return [...session.models].sort().join(', ').toLocaleLowerCase();
      case 'branch':
        return (session.gitBranch ?? '').toLocaleLowerCase();
      case 'messages':
        return session.messageCount;
      case 'tokens':
        return total(session.tokens);
      case 'cost':
        return session.costUsd;
      default:
        return session.lastAt ?? '';
    }
  };
  return sessions
    .filter((session) =>
      [session.title, session.gitBranch ?? '', ...session.models].some((text) =>
        text.toLocaleLowerCase().includes(needle),
      ),
    )
    .sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return order * (direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
    });
}

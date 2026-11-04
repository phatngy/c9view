import type { ReactNode } from 'react';
import type { KanbanColumn, TokenTotals } from '@c9view/api';
import { EmptyState, Skeleton } from './kit/index.js';

export const columns: KanbanColumn[] = [
  'inactive',
  'need_input',
  'in_progress',
  'in_review',
];
export const labels: Record<KanbanColumn, string> = {
  inactive: 'Inactive',
  need_input: 'Need input',
  in_progress: 'In progress',
  in_review: 'In review',
};
export const number = (value: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
export const money = (value: number) =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
export const total = (tokens: TokenTotals) =>
  tokens.input +
  tokens.output +
  tokens.cacheRead +
  tokens.cacheCreation +
  tokens.thinking;
export function relative(date: string | null) {
  if (!date) return 'No activity';
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
export function ColumnChip({
  column,
  count,
}: {
  column: KanbanColumn;
  count?: number;
}) {
  return (
    <span className={`column-chip ${column}`}>
      <span className="dot" />
      {labels[column]}
      {count !== undefined && <strong>{count}</strong>}
    </span>
  );
}
export function Empty({ children }: { children: string }) {
  return <EmptyState compact title={children} />;
}
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
export function Failure({
  error,
  retry,
}: {
  error: Error;
  retry: () => unknown;
}) {
  return (
    <div role="alert" className="panel space-y-3 border-danger">
      <h2>Unable to load data</h2>
      <p>{error.message}</p>
      <button onClick={() => void retry()}>Try again</button>
    </div>
  );
}
export function ModelTable({
  models,
  costLabel = 'API-equivalent',
  approximate = false,
}: {
  models: { model: string; tokens: TokenTotals; costUsd: number }[];
  costLabel?: ReactNode;
  approximate?: boolean;
}) {
  return models.length ? (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Tokens</th>
            <th>{costLabel}</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.model}>
              <td className="font-mono text-small">{m.model}</td>
              <td>{number(total(m.tokens))}</td>
              <td>
                {approximate && '≈ '}
                {money(m.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>No model usage yet.</Empty>
  );
}

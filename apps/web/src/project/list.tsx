import { useMachineId } from '../machine.js';
import { useLabels } from '../control/useLabels.js';
import { SessionTitle } from '../control/SessionLabel.js';
import { Link } from '@tanstack/react-router';
import type { SessionSummary } from '@c9view/api';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Badge, Button } from '../kit/index.js';
import { labels, money, number, relative, total } from '../ui.js';
import { sortFields } from './sessions.js';

const numericColumns = new Set(['messages', 'tokens', 'cost']);

export function SessionList({
  sessions,
  projectId,
  sort,
  onSort,
}: {
  sessions: SessionSummary[];
  projectId: string;
  sort: string;
  onSort: (value: string) => void;
}) {
  const machineId = useMachineId();
  const { labelFor } = useLabels();
  return (
    <div
      className="project-list"
      role="region"
      aria-label="Sessions table"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {sortFields.map(({ value, label }) => {
              const active = sort.startsWith(`${value}-`);
              const ascending = sort.endsWith('-asc');
              const Icon = active
                ? ascending
                  ? ArrowUp
                  : ArrowDown
                : ArrowUpDown;
              return (
                <th
                  key={value}
                  className={`${numericColumns.has(value) ? 'text-right' : ''} whitespace-nowrap`}
                  aria-sort={
                    active ? (ascending ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <Button
                    variant="ghost"
                    className={`w-full whitespace-nowrap ${numericColumns.has(value) ? 'justify-end' : 'justify-start'}`}
                    onClick={() =>
                      onSort(`${value}-${active && ascending ? 'desc' : 'asc'}`)
                    }
                  >
                    {label}
                    <Icon size={16} aria-hidden="true" />
                  </Button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id}>
              <td>
                <Link
                  to="/m/$machineId/projects/$projectId/sessions/$sessionId"
                  params={{ machineId, projectId, sessionId: session.id }}
                >
                  <SessionTitle
                    projectId={projectId}
                    sessionId={session.id}
                    title={session.title}
                    label={labelFor(projectId, session.id)}
                  />
                </Link>
              </td>
              <td>
                <Badge status={session.status.column}>
                  {labels[session.status.column]}
                </Badge>
                <p className="mt-1 text-xs text-muted">
                  {session.status.reason}
                </p>
              </td>
              <td>
                <div className="flex flex-nowrap gap-1">
                  {session.models.map((model) => (
                    <Badge
                      model={model}
                      key={model}
                      className="whitespace-nowrap"
                    />
                  ))}
                </div>
              </td>
              <td className="font-mono text-small">
                {session.gitBranch ?? '—'}
              </td>
              <td>
                <time dateTime={session.lastAt ?? undefined}>
                  {relative(session.lastAt)}
                </time>
              </td>
              <td className="text-right tabular-nums">
                {number(session.messageCount)}
              </td>
              <td className="text-right tabular-nums">
                {number(total(session.tokens))}
              </td>
              <td className="text-right tabular-nums">
                ≈ {money(session.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-3 text-xs text-muted">
        <a href="#api-equivalent-cost">Costs are API-equivalent estimates</a>
      </p>
    </div>
  );
}

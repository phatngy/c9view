import type { Message } from '@c9view/api';
import { number } from '../ui.js';
import { buildTurns } from './turns.js';
export function ContextUsage({ messages }: { messages: Message[] }) {
  const { turns } = buildTurns(messages);
  const visible = turns.slice(-24);
  const total = (turn: (typeof visible)[number]) => turn.fresh + turn.output;
  const max = Math.max(1, ...visible.map(total));
  const input = turns.reduce((sum, turn) => sum + turn.input, 0);
  const cache = turns.reduce((sum, turn) => sum + turn.cacheRead, 0);
  const latest = turns.at(-1);
  return (
    <section className="panel">
      <h2 tabIndex={-1}>Tokens per turn</h2>
      <div
        className="turn-chart"
        role="img"
        aria-label={`Output plus new input per turn, last ${visible.length} loaded turns; latest ${latest ? total(latest) : 0} tokens`}
      >
        {visible.map((turn, index) => (
          <span
            key={turn.startId}
            className={
              index === visible.length - 1 ? 'bg-accent' : 'bg-accent-soft'
            }
            style={{
              height: `${Math.max(2, (total(turn) / max) * 100)}%`,
            }}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">Cache hit</dt>
          <dd className="mt-1 text-title font-semibold tabular-nums">
            {input ? `${((cache / input) * 100).toFixed(1)}%` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted">This turn</dt>
          <dd className="mt-1 text-title font-semibold tabular-nums">
            {number(latest ? total(latest) : 0)}
          </dd>
        </div>
      </dl>
      <table className="sr-only">
        <caption>Tokens per assistant turn</caption>
        <thead>
          <tr>
            <th>Turn</th>
            <th>New input</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn, i) => (
            <tr key={turn.startId}>
              <th>{i + 1}</th>
              <td>{turn.fresh}</td>
              <td>{turn.output}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

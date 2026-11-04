import type { TurnSummary } from '../turns.js';
import { number } from '../../ui.js';
import { clockTime } from './time.js';
export function TurnDivider({ turn }: { turn: TurnSummary }) {
  if (!turn.requests) return null;
  const time = turn.endAt ? clockTime(turn.endAt) : null;
  const percent =
    turn.cacheHit === null ? null : Math.round(turn.cacheHit * 100);
  const full = (value: number) => value.toLocaleString('en-US');
  const label = `Turn ended${time ? ` ${time}` : ''}. Output ${full(turn.output)} tokens, input ${full(turn.input)} tokens, cache read ${full(turn.cacheRead)} tokens${percent === null ? '' : `, ${percent} percent cached`}.${turn.requests > 1 ? ` ${turn.requests} requests.` : ''}`;
  return (
    <div
      role="separator"
      aria-label={label}
      className="my-3 flex items-center gap-3 text-xs text-muted"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span aria-hidden="true">
        {time && `${time} · `}out {number(turn.output)} · in{' '}
        {number(turn.input)} · cache read {number(turn.cacheRead)}
        {percent !== null && ` (${percent}%)`}
        {turn.requests > 1 && ` · ${turn.requests} requests`}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}

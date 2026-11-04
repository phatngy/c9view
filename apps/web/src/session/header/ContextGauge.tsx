import type { contextUsage } from '../context.js';
import { number } from '../../ui.js';

// Approximate: Claude Code does not record its auto-compaction threshold.
export const COMPACT_MARK = 0.8;
export function ContextGauge({
  usage,
}: {
  usage: ReturnType<typeof contextUsage>;
}) {
  const { used, capacity, percent } = usage;
  const color =
    percent >= 80
      ? 'bg-danger'
      : percent >= 60
        ? 'bg-need-input'
        : 'bg-success';
  return (
    <div className="flex flex-[0_1_220px] flex-col gap-1.5 text-xs text-muted">
      <div className="flex justify-between gap-4">
        <span>Context window</span>
        <span className="font-medium text-ink">{Math.round(percent)}%</span>
      </div>
      <div
        role="img"
        aria-label={`Context window ${Math.round(percent)} percent full (approximate); auto-compaction near 80 percent`}
        className="relative h-2 rounded-full bg-surface"
      >
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
        <span
          className="absolute -top-[3px] h-3.5 w-0.5 bg-line-strong"
          style={{ left: `${COMPACT_MARK * 100}%` }}
        />
      </div>
      <p className="text-caption">
        {number(used)} of {number(capacity)} · compacts near 80%
      </p>
      <p className="sr-only">
        Approximate: assumes 200,000 tokens; infers 1,000,000 if any loaded
        assistant turn exceeds 200,000 input and cache tokens, or has an
        explicit [1m] model suffix.
      </p>
    </div>
  );
}

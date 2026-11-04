import type { ReactNode } from 'react';
export function Stat({
  label,
  value,
  detail,
  hint,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <dl className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-sans text-title font-semibold tracking-[-.01em] text-ink tabular-nums">
        {value}
      </dd>
      {(hint ?? detail) && (
        <dd className="mt-1 text-xs text-muted">{hint ?? detail}</dd>
      )}
    </dl>
  );
}

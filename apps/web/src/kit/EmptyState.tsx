import type { ReactNode } from 'react';
export function EmptyState({
  title,
  description,
  text,
  compact = false,
  action,
  icon,
  headingLevel = 2,
}: {
  title: string;
  description?: ReactNode;
  text?: ReactNode;
  compact?: boolean;
  action?: ReactNode;
  icon?: ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  if (compact) {
    return <p className="m-0 text-xs text-muted">{title}</p>;
  }
  const Heading = `h${headingLevel}` as
    | 'h1'
    | 'h2'
    | 'h3'
    | 'h4'
    | 'h5'
    | 'h6';
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && (
        <span aria-hidden="true" className="text-muted">
          {icon}
        </span>
      )}
      <Heading className="text-base font-medium text-ink">{title}</Heading>
      {(text ?? description) && (
        <p className="max-w-md text-sm text-muted">{text ?? description}</p>
      )}
      {action}
    </div>
  );
}

import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './classes.js';
export interface CardProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  title?: ReactNode;
  action?: ReactNode;
}
export function Card({
  className,
  title,
  action,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cx('rounded-xl border border-line bg-panel p-5', className)}
      {...props}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

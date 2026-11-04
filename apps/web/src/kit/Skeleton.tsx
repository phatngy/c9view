import type { HTMLAttributes } from 'react';
import { cx } from './classes.js';
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cx(
        'h-4 rounded bg-surface motion-safe:animate-pulse',
        className,
      )}
    />
  );
}

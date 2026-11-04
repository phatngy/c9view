import type { HTMLAttributes } from 'react';
import { cx } from './classes.js';
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      {...props}
      className={cx(
        'rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-small text-muted',
        className,
      )}
    />
  );
}

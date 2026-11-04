import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing, target } from './classes.js';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'primary' | 'danger';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  buttonRef?: (button: HTMLButtonElement | null) => void;
}
const variants = {
  default: 'border border-line bg-raised text-ink hover:bg-surface',
  secondary: 'border border-line bg-raised text-ink hover:bg-surface',
  ghost:
    'border border-transparent bg-transparent text-muted hover:bg-surface hover:text-ink',
  primary: 'border border-accent bg-accent text-page hover:opacity-90',
  danger: 'border border-danger bg-danger text-white hover:opacity-90',
};
export function Button({
  variant = 'default',
  size = 'md',
  type = 'button',
  className,
  icon: Icon,
  buttonRef,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      type={type}
      data-primary-control
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        target,
        focusRing,
        variants[variant],
        size === 'sm' ? 'px-2.5 sm:h-8' : 'px-3 sm:h-10',
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

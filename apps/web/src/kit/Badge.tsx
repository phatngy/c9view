import type { HTMLAttributes } from 'react';
import { cx } from './classes.js';
import { modelFamily, modelLabel, type ModelFamily } from './model.js';
export type BadgeStatus =
  | 'inactive'
  | 'need-input'
  | 'in-progress'
  | 'in-review'
  | 'need_input'
  | 'in_progress'
  | 'in_review';
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status?: BadgeStatus;
  model?: string;
  tone?: 'neutral' | 'model' | BadgeStatus;
  family?: ModelFamily;
}
const statusColors = {
  inactive: 'text-inactive',
  'need-input': 'text-need-input',
  'in-progress': 'text-in-progress',
  'in-review': 'text-in-review',
};
const modelColors = {
  opus: 'text-model-opus',
  sonnet: 'text-model-sonnet',
  haiku: 'text-model-haiku',
  fable: 'text-model-fable',
  other: 'text-model-other',
};
export function Badge({
  status,
  model,
  family,
  tone = 'neutral',
  children,
  className,
  ...props
}: BadgeProps) {
  const normalized = (
    status ?? (tone !== 'neutral' && tone !== 'model' ? tone : undefined)
  )?.replaceAll('_', '-') as keyof typeof statusColors | undefined;
  return (
    <span
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border border-current/15 bg-current/5 px-2 py-0.5 text-xs font-medium',
        normalized
          ? statusColors[normalized]
          : model || tone === 'model'
            ? 'text-ink'
            : 'text-muted',
        className,
      )}
    >
      {normalized && (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {(model || tone === 'model') && (
        <span
          aria-hidden="true"
          className={cx(
            'size-2 rounded-sm bg-current',
            modelColors[family ?? modelFamily(model ?? '')],
          )}
        />
      )}
      {children ??
        (model
          ? modelLabel(model)
          : family
            ? family[0]!.toUpperCase() + family.slice(1)
            : normalized?.replaceAll('-', ' '))}
    </span>
  );
}

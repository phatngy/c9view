import { Select as BaseSelect } from '@base-ui/react/select';
import type { ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cx, focusRing, target, popup, option } from './classes.js';
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectProps {
  label: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  name?: string;
  labelledBy?: string;
  /** `pill` is a compact ghost trigger for toolbars; menu opens upward. */
  variant?: 'field' | 'pill';
  icon?: ReactNode;
}
export function Select({
  label,
  labelledBy,
  options,
  onValueChange,
  placeholder = 'Select…',
  className,
  variant = 'field',
  icon,
  ...props
}: SelectProps) {
  const pill = variant === 'pill';
  return (
    <BaseSelect.Root
      {...props}
      items={options}
      onValueChange={(value) => {
        if (value !== null) onValueChange?.(value);
      }}
    >
      <BaseSelect.Trigger
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        data-primary-control
        className={cx(
          target,
          focusRing,
          'inline-flex items-center text-sm disabled:opacity-40',
          pill
            ? 'justify-center gap-1.5 rounded-full border border-transparent bg-transparent px-3 text-muted hover:bg-surface hover:text-ink'
            : 'justify-between gap-3 rounded-md border border-line bg-raised px-3 text-ink',
          className,
        )}
      >
        {icon}
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon>
          <ChevronDown size={14} aria-hidden="true" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          sideOffset={4}
          className="z-50"
          {...(pill
            ? {
                side: 'top' as const,
                align: 'start' as const,
                alignItemWithTrigger: false,
              }
            : {})}
        >
          <BaseSelect.Popup
            className={cx(popup, 'min-w-[var(--anchor-width)]')}
          >
            <BaseSelect.List>
              {options.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className={option}
                >
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="ml-auto">
                    <Check size={14} aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

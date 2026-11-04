import { Select as BaseSelect } from '@base-ui/react/select';
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
}
export function Select({
  label,
  labelledBy,
  options,
  onValueChange,
  placeholder = 'Select…',
  className,
  ...props
}: SelectProps) {
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
          'inline-flex items-center justify-between gap-3 rounded-md border border-line bg-raised px-3 text-sm text-ink disabled:opacity-40',
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon>
          <ChevronDown size={14} aria-hidden="true" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50">
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

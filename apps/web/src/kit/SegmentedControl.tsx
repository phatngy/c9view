import { useRef, useState } from 'react';
import { cx, focusRing, target } from './classes.js';
import type { SelectProps } from './Select.js';
export type SegmentedControlProps = Omit<SelectProps, 'placeholder' | 'name'>;
export function SegmentedControl({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  disabled,
  className,
}: SegmentedControlProps) {
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? options.find((item) => !item.disabled)?.value,
  );
  const selected = value ?? internalValue;
  const group = useRef<HTMLDivElement>(null);
  function select(next: string) {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  }
  return (
    <div
      ref={group}
      role="group"
      aria-label={label}
      className={cx(
        'inline-flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1',
        className,
      )}
    >
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          data-primary-control
          disabled={disabled || item.disabled}
          aria-pressed={selected === item.value}
          tabIndex={selected === item.value ? 0 : -1}
          onClick={() => select(item.value)}
          onKeyDown={(event) => {
            if (
              ![
                'ArrowRight',
                'ArrowLeft',
                'ArrowDown',
                'ArrowUp',
                'Home',
                'End',
              ].includes(event.key)
            )
              return;
            event.preventDefault();
            const buttons = Array.from(
              group.current?.querySelectorAll<HTMLButtonElement>(
                'button:not(:disabled)',
              ) ?? [],
            );
            const index = buttons.indexOf(event.currentTarget);
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index +
                      (event.key === 'ArrowRight' || event.key === 'ArrowDown'
                        ? 1
                        : -1) +
                      buttons.length) %
                    buttons.length;
            const next = buttons[nextIndex];
            next?.focus();
            next?.click();
          }}
          className={cx(
            target,
            focusRing,
            'inline-flex cursor-pointer items-center justify-center rounded-md px-3 text-sm text-muted aria-pressed:bg-accent-soft aria-pressed:text-accent disabled:opacity-40',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

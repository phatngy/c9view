import type { ReactNode } from 'react';
import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import { Badge } from './Badge.js';
import { cx, focusRing, target } from './classes.js';
export interface TabItem {
  value: string;
  label: ReactNode;
  content?: ReactNode;
  count?: number;
  disabled?: boolean;
}
export interface TabsProps {
  items: TabItem[];
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}
export function Tabs({
  items,
  label,
  onValueChange,
  className,
  ...props
}: TabsProps) {
  return (
    <BaseTabs.Root
      {...props}
      onValueChange={(value) => {
        if (typeof value === 'string') onValueChange?.(value);
      }}
      className={className}
    >
      <BaseTabs.List
        aria-label={label}
        className="flex gap-1 border-b border-line"
      >
        {items.map((item) => (
          <BaseTabs.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            data-primary-control
            className={cx(
              target,
              focusRing,
              'inline-flex items-center gap-2 border-b-2 border-transparent px-3 text-sm text-muted data-[active]:border-accent data-[active]:text-ink disabled:opacity-40',
            )}
          >
            {item.label}
            {item.count !== undefined && <Badge>{item.count}</Badge>}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {items.map(
        (item) =>
          item.content !== undefined && (
            <BaseTabs.Panel
              key={item.value}
              value={item.value}
              className={cx('pt-4', focusRing)}
            >
              {item.content}
            </BaseTabs.Panel>
          ),
      )}
    </BaseTabs.Root>
  );
}

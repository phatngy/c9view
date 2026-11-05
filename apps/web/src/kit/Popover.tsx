import type { ReactElement, ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { cx, popup } from './classes.js';

/** Click or keyboard (Enter/Space) opens; Escape closes and returns focus. */
export function Popover({
  trigger,
  children,
  label,
  className,
}: {
  trigger: ReactElement;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="z-50"
        >
          <BasePopover.Popup
            aria-label={label}
            className={cx(popup, 'max-w-[calc(100vw-2rem)] p-4', className)}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

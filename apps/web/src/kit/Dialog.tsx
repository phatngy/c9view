import { useRef, type ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Where focus goes after close; defaults to the element focused before open. */
  finalFocus?: () => HTMLElement | boolean | null;
  className?: string;
}

/** A labelled modal surface with Base UI focus management and dismissal. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  finalFocus,
  className = '',
}: DialogProps) {
  const popup = useRef<HTMLDivElement | null>(null);
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-ink/40" />
        <BaseDialog.Popup
          ref={popup}
          initialFocus={() =>
            popup.current?.querySelector<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )
          }
          {...(finalFocus ? { finalFocus } : {})}
          className={`fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line-strong bg-raised p-5 text-ink shadow-lg outline-none ${className}`}
        >
          <BaseDialog.Title className="text-base font-semibold">
            {title}
          </BaseDialog.Title>
          {description !== undefined && (
            <BaseDialog.Description className="mt-2 text-sm text-muted">
              {description}
            </BaseDialog.Description>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

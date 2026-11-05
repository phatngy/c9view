import { useRef, type ReactNode } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from './Button.js';
import { cx } from './classes.js';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button with the danger token. */
  destructive?: boolean;
  /** Disables Confirm (and Cancel) while the confirmed work is pending. */
  pending?: boolean;
  onConfirm: () => void;
  /** Fires once the dialog has fully closed and unmounted. */
  onClosed?: () => void;
  /** Where focus goes on close (false: leave it to the caller); defaults to the element focused before open. */
  finalFocus?: () => HTMLElement | boolean | null;
}

/**
 * A focused yes/no confirmation. Cancel has initial focus; Escape and Cancel
 * close it without confirming; clicking outside does nothing (alert dialog).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onConfirm,
  onClosed,
  finalFocus,
}: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement | null>(null);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-ink/40" />
        <AlertDialog.Popup
          initialFocus={cancel}
          {...(finalFocus ? { finalFocus } : {})}
          className="fixed top-1/2 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line-strong bg-raised p-5 text-ink shadow-lg"
        >
          <AlertDialog.Title className="text-base font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              buttonRef={(button) => (cancel.current = button)}
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              disabled={pending}
              onClick={onConfirm}
              className={cx(pending && 'cursor-wait')}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

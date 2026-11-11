import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button, IconButton } from '../kit/index.js';
import { focusRing } from '../kit/classes.js';
import { queryKeys } from '../queryKeys.js';
import { ControlError, unknownOutcome } from './api.js';
import { useLabels } from './useLabels.js';

export const LABEL_TOOLTIP = 'label in c9view';

/** The c9view label in place of the title, with a tooltip; the title when there is none. */
export function SessionTitle({
  projectId,
  sessionId,
  title,
  label: given,
}: {
  projectId: string;
  sessionId: string;
  title: string;
  /** Pass a label already looked up by a parent to avoid a hook per row. */
  label?: string | undefined;
}) {
  const { labelFor } = useLabels();
  const label = given ?? labelFor(projectId, sessionId);
  return label ? (
    <span title={LABEL_TOOLTIP}>
      {label}
      <span className="sr-only"> ({LABEL_TOOLTIP})</span>
    </span>
  ) : (
    <>{title || 'Untitled session'}</>
  );
}

/** Inline editor for the c9view label; renders nothing unless control is ready. */
export function SessionLabel({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const { labelFor, control, machineId } = useLabels();
  const client = useQueryClient();
  const current = labelFor(projectId, sessionId) ?? '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const edit = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) edit.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  if (!control.ready) return null;
  const close = () => {
    setEditing(false);
    setNotice('');
  };
  async function save() {
    if (pending) return;
    setPending(true);
    setNotice('');
    try {
      const receipt = await control.service.label(
        projectId,
        sessionId,
        value.trim(),
      );
      if (receipt.status === 'failed') setNotice(receipt.error ?? 'Failed.');
      else {
        await client.invalidateQueries({
          queryKey: queryKeys.labels(machineId),
        });
        setEditing(false);
      }
    } catch (error) {
      if (error instanceof ControlError && error.kind === 'uncertain') {
        setNotice(
          'This may have been sent. The label list was refreshed; check it before saving again.',
        );
        void client.invalidateQueries({
          queryKey: queryKeys.labels(machineId),
        });
      } else if (
        error instanceof ControlError &&
        error.reason === 'unknown-outcome'
      )
        setNotice(unknownOutcome);
      else setNotice(error instanceof Error ? error.message : 'Failed.');
    } finally {
      setPending(false);
    }
  }
  if (!editing)
    return (
      <IconButton
        label={current ? 'Edit label' : 'Add label'}
        icon={Pencil}
        buttonRef={(button) => (edit.current = button)}
        onClick={() => {
          setValue(current);
          setEditing(true);
        }}
      />
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      aria-label="Session label"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <label className="sr-only" htmlFor="session-label-input">
        c9view label
      </label>
      <input
        id="session-label-input"
        ref={input}
        value={value}
        maxLength={80}
        placeholder="Label (empty removes it)"
        onChange={(event) => setValue(event.target.value.slice(0, 80))}
        className={`${focusRing} min-h-11 rounded-md border border-line bg-raised px-3 text-sm text-ink sm:min-h-10`}
      />
      <Button type="submit" variant="primary" disabled={pending}>
        Save
      </Button>
      <Button disabled={pending} onClick={close}>
        Cancel
      </Button>
      {notice && (
        <p role="status" className="basis-full text-xs text-muted">
          {notice}
        </p>
      )}
    </form>
  );
}

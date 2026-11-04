import { queryKeys } from '../queryKeys.js';
import { useMachineId } from '../machine.js';
import type { ToolFileChange } from '@c9view/api';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fileQueryOptions } from '../api.js';
import { DiffView } from '../diff/DiffView.js';
import { Empty, Failure, Loading } from '../ui.js';
import { toolAnchor } from '../tools/ToolCard.js';

export function SessionChanges({
  projectId,
  sessionId,
  requestedTool,
  dismiss,
  jump,
}: {
  projectId: string;
  sessionId: string;
  requestedTool?: string | undefined;
  dismiss: () => void;
  jump: (id: string) => void;
}) {
  const machineId = useMachineId();
  const [selected, setSelected] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedStep = useRef<HTMLLIElement>(null);
  const list = useQuery({
    queryKey: queryKeys.changes(machineId, projectId, sessionId),
    queryFn: ({ signal }) =>
      api.changes(machineId, projectId, sessionId, signal),
    ...fileQueryOptions,
  });
  const requested = list.data?.files.find(
    (file) => requestedTool && file.toolUseIds.includes(requestedTool),
  );
  const fileId = selected || requested?.fileId || '';
  const diff = useQuery({
    queryKey: queryKeys.change(machineId, projectId, sessionId, fileId),
    queryFn: ({ signal }) =>
      api.change(machineId, projectId, sessionId, fileId, signal),
    enabled: !!fileId,
    ...fileQueryOptions,
  });
  useEffect(() => {
    if (fileId && dialog.current && !dialog.current.open)
      dialog.current.showModal?.();
  }, [fileId]);
  useEffect(() => {
    selectedStep.current?.scrollIntoView?.({ block: 'nearest' });
  }, [diff.data, requestedTool]);
  const close = () => {
    dismiss();
    setSelected('');
    dialog.current?.close();
  };
  return (
    <section
      className="panel min-w-0"
      id="files-changed"
      aria-label="Files changed"
    >
      <div className="rail-heading">
        <h2>Files changed</h2>
        {list.data && (
          <span className="text-xs text-muted">
            {list.data.files.length} files
          </span>
        )}
      </div>
      <div>
        {list.error ? (
          <Failure error={list.error} retry={list.refetch} />
        ) : !list.data ? (
          <Loading />
        ) : !list.data.files.length ? (
          <Empty>No changed files.</Empty>
        ) : (
          list.data.files.map((file) => (
            <button
              key={file.fileId}
              className="file-change-row"
              onClick={() => setSelected(file.fileId)}
            >
              <span
                className="min-w-0 flex-1 truncate font-mono text-small"
                title={file.relPath || file.filePath}
              >
                {file.relPath || file.filePath}
              </span>
              <span className="text-xs text-success">+{file.additions}</span>{' '}
              <span className="text-xs text-danger">−{file.deletions}</span>
            </button>
          ))
        )}
        {requestedTool && list.data && !requested && (
          <p role="note">
            This tool call has no available full diff in the returned file list.
          </p>
        )}
        {list.data?.truncated && (
          <p role="note">Changed file list is truncated.</p>
        )}
      </div>
      {fileId && (
        <dialog
          ref={dialog}
          className="diff-dialog"
          aria-label="Session file diff"
          onCancel={close}
          onClose={close}
        >
          <button autoFocus onClick={close}>
            Close diff
          </button>
          {diff.error ? (
            <Failure error={diff.error} retry={diff.refetch} />
          ) : !diff.data ? (
            <Loading />
          ) : (
            <>
              <DiffView
                {...diff.data}
                kind={
                  list.data?.files.find((file) => file.fileId === fileId)?.kind
                }
              />
              <h3 className="mt-4 font-semibold">Steps</h3>
              <ol>
                {diff.data.steps.map((step, index) => (
                  <li
                    ref={
                      step.toolUseId === requestedTool
                        ? selectedStep
                        : undefined
                    }
                    key={`${step.toolUseId}-${index}`}
                    className={`my-2 ${step.toolUseId === requestedTool ? 'selected-line' : ''}`}
                  >
                    <a
                      className="text-accent underline"
                      href={`#${toolAnchor(step.toolUseId)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        close();
                        jump(step.toolUseId);
                      }}
                    >
                      {step.tool} · +{step.additions} −{step.deletions}
                      {step.toolUseId === requestedTool
                        ? ' · Selected step'
                        : ''}
                    </a>
                    {step.userModified && (
                      <span className="badge">User modified</span>
                    )}
                    <StepDiff
                      step={step}
                      selected={step.toolUseId === requestedTool}
                    />
                  </li>
                ))}
              </ol>
            </>
          )}
        </dialog>
      )}
    </section>
  );
}

function StepDiff({
  step,
  selected,
}: {
  step: ToolFileChange;
  selected: boolean;
}) {
  const [open, setOpen] = useState(selected);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Step diff</summary>
      {open && <DiffView {...step} />}
    </details>
  );
}

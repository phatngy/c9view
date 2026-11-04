import { queryKeys } from '../queryKeys.js';
import { useMachineId } from '../machine.js';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fileQueryOptions } from '../api.js';
import { DiffView } from '../diff/DiffView.js';
import { Empty, Loading } from '../ui.js';
import { FileFailure } from './shared.js';
export function ProjectChanges({ projectId }: { projectId: string }) {
  const machineId = useMachineId();
  const [selected, setSelected] = useState('');
  const status = useQuery({
    queryKey: queryKeys.gitStatus(machineId, projectId),
    queryFn: ({ signal }) => api.gitStatus(machineId, projectId, signal),
    ...fileQueryOptions,
  });
  const diff = useQuery({
    queryKey: queryKeys.gitDiff(machineId, projectId, selected),
    queryFn: ({ signal }) =>
      api.gitDiff(machineId, projectId, selected, signal),
    enabled: !!selected,
    ...fileQueryOptions,
  });
  if (status.error)
    return <FileFailure error={status.error} retry={status.refetch} />;
  if (!status.data) return <Loading />;
  if (!status.data.isRepo)
    return <Empty>This project is not a Git repository.</Empty>;
  return (
    <section className="min-w-0 space-y-3" aria-label="Working tree changes">
      <p className="font-mono text-small">
        ⑂ {status.data.branch} · {status.data.ahead} ahead ·{' '}
        {status.data.behind} behind
      </p>
      {!status.data.files.length && <Empty>No uncommitted changes.</Empty>}
      {status.data.files.map((file) => (
        <div className="panel" key={file.path}>
          <button
            className="w-full text-left break-all font-mono text-small"
            aria-expanded={selected === file.path}
            onClick={() => setSelected(selected === file.path ? '' : file.path)}
          >
            {file.path} <span className="badge">{file.status}</span>
          </button>
          {selected === file.path &&
            (diff.error ? (
              <FileFailure error={diff.error} retry={diff.refetch} />
            ) : !diff.data ? (
              <Loading />
            ) : diff.data.files.length ? (
              diff.data.files.map((patch) => (
                <DiffView
                  key={patch.path}
                  filePath={patch.path}
                  hunks={patch.hunks}
                  kind={
                    file.status === 'added' || file.status === 'untracked'
                      ? 'create'
                      : file.status === 'deleted'
                        ? 'delete'
                        : file.status === 'renamed'
                          ? 'rename'
                          : 'update'
                  }
                />
              ))
            ) : (
              <Empty>No text diff available (untracked or binary file).</Empty>
            ))}
        </div>
      ))}
    </section>
  );
}

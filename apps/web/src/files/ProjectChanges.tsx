import { queryKeys } from '../queryKeys.js';
import { useMachineId } from '../machine.js';
import { useState } from 'react';
import { api } from '../api.js';
import { useCursorList, useGitStatus } from './paging.js';
import { LoadMore } from './LoadMore.js';
import { DiffView } from '../diff/DiffView.js';
import { Empty, Loading } from '../ui.js';
import { FileFailure } from './shared.js';
export function ProjectChanges({ projectId }: { projectId: string }) {
  const machineId = useMachineId();
  const [selected, setSelected] = useState('');
  const status = useGitStatus(projectId);
  const diff = useCursorList(
    queryKeys.gitDiff(machineId, projectId, selected),
    (signal, cursor) =>
      api.gitDiff(machineId, projectId, selected, signal, cursor),
    (pages) => ({ ...pages[0]!, files: pages.flatMap((page) => page.files) }),
    !!selected,
  );
  if (status.error && !status.data)
    return <FileFailure error={status.error} retry={status.refetch} />;
  if (!status.data) return <Loading />;
  if (!status.data.isRepo)
    return <Empty>This project is not a Git repository.</Empty>;
  return (
    <section
      data-page-list
      tabIndex={-1}
      className="min-w-0 space-y-3"
      aria-label="Working tree changes"
    >
      <p className="font-mono text-small">
        ⑂ {status.data.branch} · {status.data.ahead} ahead ·{' '}
        {status.data.behind} behind
      </p>
      {!status.data.files.length && <Empty>No uncommitted changes.</Empty>}
      {status.data.files.map((file) => (
        <div data-page-list tabIndex={-1} className="panel" key={file.path}>
          <button
            className="w-full text-left break-all font-mono text-small"
            aria-expanded={selected === file.path}
            onClick={() => setSelected(selected === file.path ? '' : file.path)}
          >
            {file.path} <span className="badge">{file.status}</span>
          </button>
          {selected === file.path &&
            (diff.error && !diff.data ? (
              <FileFailure error={diff.error} retry={diff.refetch} />
            ) : !diff.data ? (
              <Loading />
            ) : diff.data.files.length ? (
              diff.data.files.map((patch) => (
                <DiffView
                  key={patch.path}
                  filePath={patch.path}
                  hunks={patch.hunks}
                  truncated={patch.truncated ?? false}
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
          {selected === file.path && (
            <LoadMore query={diff} label="file diffs" />
          )}
        </div>
      ))}
      <LoadMore query={status} label="changed files" />
    </section>
  );
}

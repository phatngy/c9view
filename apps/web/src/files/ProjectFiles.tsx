import { useQuery } from '@tanstack/react-query';
import { api, fileQueryOptions, HttpError } from '../api.js';
import { FileTree } from './FileTree.js';
import { FileViewer } from './FileViewer.js';
import { FileFailure } from './shared.js';
import { Loading } from '../ui.js';
export function ProjectFiles({
  projectId,
  path,
  line,
  select,
}: {
  projectId: string;
  path: string;
  line: string;
  select: (path: string) => void;
}) {
  const status = useQuery({
    queryKey: ['git-status', projectId],
    queryFn: ({ signal }) => api.gitStatus(projectId, signal),
    ...fileQueryOptions,
  });
  const file = useQuery({
    queryKey: ['file', projectId, path],
    queryFn: ({ signal }) => api.file(projectId, path, signal),
    enabled: !!path,
    ...fileQueryOptions,
  });
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
      <div className={`panel ${path ? 'hidden md:block' : ''}`}>
        <FileTree
          key={projectId}
          projectId={projectId}
          status={status.data}
          onOpen={(entry) => select(entry.path)}
        />
      </div>
      <div className={`panel ${path ? '' : 'hidden md:block'}`}>
        {path && (
          <button className="mb-3 md:hidden" onClick={() => select('')}>
            Back to tree
          </button>
        )}
        {file.error ? (
          file.error instanceof HttpError && file.error.status === 400 ? (
            <FileViewer denied={file.error.message} />
          ) : (
            <FileFailure error={file.error} retry={file.refetch} />
          )
        ) : path && !file.data ? (
          <Loading />
        ) : (
          <FileViewer file={file.data} line={line} />
        )}
      </div>
    </div>
  );
}

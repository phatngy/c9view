import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import type { GitStatusResponse } from '@c9view/api';
import { api, fileQueryOptions } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';

/** Sequential refetch follows fresh cursors for every loaded page. */
export function useCursorList<T extends object>(
  queryKey: QueryKey,
  read: (signal: AbortSignal, cursor?: string) => Promise<T>,
  merge: (pages: T[]) => T,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) => read(signal, pageParam),
    getNextPageParam: (page) =>
      'nextCursor' in page
        ? ((page.nextCursor as string | null | undefined) ?? undefined)
        : undefined,
    select: (data) => merge(data.pages),
    enabled,
    ...fileQueryOptions,
  });
}

export function useGitStatus(projectId: string) {
  const machineId = useMachineId();
  return useCursorList<GitStatusResponse>(
    queryKeys.gitStatus(machineId, projectId),
    (signal, cursor) => api.gitStatus(machineId, projectId, signal, cursor),
    (pages) => {
      const first = pages[0]!;
      return first.isRepo
        ? {
            ...first,
            files: pages.flatMap((page) => (page.isRepo ? page.files : [])),
          }
        : first;
    },
  );
}

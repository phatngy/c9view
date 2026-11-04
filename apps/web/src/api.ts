import { useMachineId } from './machine.js';
import { queryKeys } from './queryKeys.js';
import { nextSessionPage, previousSessionPage } from './session/paging.js';
import { useLivePolling } from './live/state.js';
import {
  replaceEqualDeep,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  MachineId,
  MachineSummary,
  FileListResponse,
  FileContentResponse,
  GitStatusResponse,
  GitDiffResponse,
  SessionChangesResponse,
  SessionFileDiffResponse,
  GlobalConfigResponse,
  OverviewResponse,
  ProjectDetailResponse,
  ProjectsResponse,
  SessionDetailResponse,
  SessionPollResponse,
  HealthResponse,
  SearchResponse,
  UsageResponse,
} from '@c9view/api';

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, signal ? { signal } : undefined);
  const body: unknown = await response.json();
  if (response.status === 401) {
    const mode =
      body &&
      typeof body === 'object' &&
      'auth' in body &&
      body.auth === 'password'
        ? 'password'
        : 'token';
    window.dispatchEvent(new CustomEvent('c9view:login', { detail: mode }));
  }
  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Request failed (${response.status})`;
    throw new HttpError(message, response.status);
  }
  return body as T;
}
export const machinePath = (machineId: MachineId, path: string) =>
  `/m/${encodeURIComponent(machineId)}${path}`;
const machineGet = <T>(
  machineId: MachineId,
  path: string,
  signal?: AbortSignal,
) => get<T>(machinePath(machineId, path), signal);
const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
export const fileQueryOptions = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} as const;
export interface SearchFilters {
  q: string;
  projectId: string;
  from: string;
  to: string;
  model: string;
}
export interface UsageFilters {
  from: string;
  to: string;
  tz: string;
  projectId: string;
}
export const SESSION_PAGE_SIZE = 50;
export type SessionPageParam = 'end' | { cursor: number; limit: number };
export const api = {
  usage: (machineId: MachineId, filters: UsageFilters, signal?: AbortSignal) =>
    machineGet<UsageResponse>(
      machineId,
      `/usage?${new URLSearchParams({ ...filters })}`,
      signal,
    ),
  hubHealth: (signal?: AbortSignal) => get<HealthResponse>('/health', signal),
  machines: (signal?: AbortSignal) =>
    get<MachineSummary[]>('/machines', signal),
  health: (machineId: MachineId, signal?: AbortSignal) =>
    machineGet<HealthResponse>(machineId, '/health', signal),
  search: (
    machineId: MachineId,
    filters: SearchFilters,
    cursor: string | null,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== ''),
    );
    if (cursor !== null) params.set('cursor', cursor);
    return machineGet<SearchResponse>(machineId, `/search?${params}`, signal);
  },
  files: (
    machineId: MachineId,
    id: string,
    path: string,
    signal?: AbortSignal,
  ) =>
    machineGet<FileListResponse>(
      machineId,
      `${projectPath(id)}/files?path=${encodeURIComponent(path)}`,
      signal,
    ),
  file: (
    machineId: MachineId,
    id: string,
    path: string,
    signal?: AbortSignal,
  ) =>
    machineGet<FileContentResponse>(
      machineId,
      `${projectPath(id)}/file?path=${encodeURIComponent(path)}`,
      signal,
    ),
  gitStatus: (machineId: MachineId, id: string, signal?: AbortSignal) =>
    machineGet<GitStatusResponse>(
      machineId,
      `${projectPath(id)}/git/status`,
      signal,
    ),
  gitDiff: (
    machineId: MachineId,
    id: string,
    path: string,
    signal?: AbortSignal,
  ) =>
    machineGet<GitDiffResponse>(
      machineId,
      `${projectPath(id)}/git/diff?path=${encodeURIComponent(path)}`,
      signal,
    ),
  changes: (
    machineId: MachineId,
    id: string,
    sid: string,
    signal?: AbortSignal,
  ) =>
    machineGet<SessionChangesResponse>(
      machineId,
      `${projectPath(id)}/sessions/${encodeURIComponent(sid)}/changes`,
      signal,
    ),
  change: (
    machineId: MachineId,
    id: string,
    sid: string,
    fileId: string,
    signal?: AbortSignal,
  ) =>
    machineGet<SessionFileDiffResponse>(
      machineId,
      `${projectPath(id)}/sessions/${encodeURIComponent(sid)}/changes/${encodeURIComponent(fileId)}`,
      signal,
    ),
  overview: (machineId: MachineId, signal?: AbortSignal) =>
    machineGet<OverviewResponse>(machineId, '/overview', signal),
  projects: (machineId: MachineId, signal?: AbortSignal) =>
    machineGet<ProjectsResponse>(machineId, '/projects', signal),
  project: (machineId: MachineId, id: string, signal?: AbortSignal) =>
    machineGet<ProjectDetailResponse>(machineId, projectPath(id), signal),
  config: (machineId: MachineId, signal?: AbortSignal) =>
    machineGet<GlobalConfigResponse>(machineId, '/config', signal),
  session: (
    machineId: MachineId,
    projectId: string,
    sessionId: string,
    page: SessionPageParam | number = 0,
    signal?: AbortSignal,
  ) =>
    machineGet<SessionDetailResponse>(
      machineId,
      `${projectPath(projectId)}/sessions/${encodeURIComponent(sessionId)}?${
        page === 'end'
          ? `from=end&limit=${SESSION_PAGE_SIZE}`
          : typeof page === 'number'
            ? `cursor=${page}&limit=${SESSION_PAGE_SIZE}`
            : `cursor=${page.cursor}&limit=${page.limit}`
      }`,
      signal,
    ),
  sessionPoll: (
    machineId: MachineId,
    projectId: string,
    sessionId: string,
    signal?: AbortSignal,
  ) =>
    machineGet<SessionPollResponse>(
      machineId,
      `${projectPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/status`,
      signal,
    ),
};
export const useOverview = () => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.overview(machineId),
    queryFn: ({ signal }) => api.overview(machineId, signal),
    refetchInterval: useLivePolling(),
  });
};
export const useProjects = () => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.projects(machineId),
    queryFn: ({ signal }) => api.projects(machineId, signal),
    refetchInterval: useLivePolling(),
  });
};
export const useProject = (id: string) => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.project(machineId, id),
    queryFn: ({ signal }) => api.project(machineId, id, signal),
    refetchInterval: useLivePolling(),
  });
};
export const useConfig = () => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.config(machineId),
    queryFn: ({ signal }) => api.config(machineId, signal),
  });
};
export const useSession = (projectId: string, sessionId: string) => {
  const machineId = useMachineId();
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: queryKeys.session(machineId, projectId, sessionId),
    initialPageParam: 'end' as SessionPageParam,
    structuralSharing: (previous, next) => {
      const data = next as InfiniteData<
        SessionDetailResponse,
        SessionPageParam
      >;
      return replaceEqualDeep(previous, {
        ...data,
        pageParams: data.pageParams.map((param, index) =>
          param === 'end'
            ? { cursor: data.pages[index]!.cursor, limit: SESSION_PAGE_SIZE }
            : param,
        ),
      });
    },
    queryFn: ({ pageParam, signal }) =>
      api.session(machineId, projectId, sessionId, pageParam, signal),
    getPreviousPageParam: (first) => previousSessionPage(first),
    getNextPageParam: (last) =>
      nextSessionPage(
        last,
        queryClient.getQueryData<SessionPollResponse>(
          queryKeys.sessionPoll(machineId, projectId, sessionId),
        )?.totalMessages,
      ),
  });
  return query;
};
export const useSessionPoll = (projectId: string, sessionId: string) => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.sessionPoll(machineId, projectId, sessionId),
    queryFn: ({ signal }) =>
      api.sessionPoll(machineId, projectId, sessionId, signal),
    refetchInterval: useLivePolling(),
  });
};

export const useHealth = (enabled = true) => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.health(machineId),
    queryFn: ({ signal }) => api.health(machineId, signal),
    enabled,
    refetchInterval: useLivePolling(),
  });
};
export const useGlobalSearch = (filters: SearchFilters) => {
  const machineId = useMachineId();
  return useInfiniteQuery({
    queryKey: queryKeys.search(machineId, filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.search(machineId, filters, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!filters.q.trim(),
    retry: (count, error) =>
      !(error instanceof HttpError && [401, 503].includes(error.status)) &&
      count < 1,
  });
};

export const useUsage = (filters: UsageFilters) => {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.usage(machineId, filters),
    queryFn: ({ signal }) => api.usage(machineId, filters, signal),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[0] === machineId ? previous : undefined,
    refetchInterval: useLivePolling(),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 503) && count < 1,
  });
};

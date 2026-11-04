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
  usage: (filters: UsageFilters, signal?: AbortSignal) =>
    get<UsageResponse>(`/usage?${new URLSearchParams({ ...filters })}`, signal),
  health: (signal?: AbortSignal) => get<HealthResponse>('/health', signal),
  search: (
    filters: SearchFilters,
    cursor: string | null,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== ''),
    );
    if (cursor !== null) params.set('cursor', cursor);
    return get<SearchResponse>(`/search?${params}`, signal);
  },
  files: (id: string, path: string, signal?: AbortSignal) =>
    get<FileListResponse>(
      `${projectPath(id)}/files?path=${encodeURIComponent(path)}`,
      signal,
    ),
  file: (id: string, path: string, signal?: AbortSignal) =>
    get<FileContentResponse>(
      `${projectPath(id)}/file?path=${encodeURIComponent(path)}`,
      signal,
    ),
  gitStatus: (id: string, signal?: AbortSignal) =>
    get<GitStatusResponse>(`${projectPath(id)}/git/status`, signal),
  gitDiff: (id: string, path: string, signal?: AbortSignal) =>
    get<GitDiffResponse>(
      `${projectPath(id)}/git/diff?path=${encodeURIComponent(path)}`,
      signal,
    ),
  changes: (id: string, sid: string, signal?: AbortSignal) =>
    get<SessionChangesResponse>(
      `${projectPath(id)}/sessions/${encodeURIComponent(sid)}/changes`,
      signal,
    ),
  change: (id: string, sid: string, fileId: string, signal?: AbortSignal) =>
    get<SessionFileDiffResponse>(
      `${projectPath(id)}/sessions/${encodeURIComponent(sid)}/changes/${encodeURIComponent(fileId)}`,
      signal,
    ),
  overview: (signal?: AbortSignal) =>
    get<OverviewResponse>('/overview', signal),
  projects: (signal?: AbortSignal) =>
    get<ProjectsResponse>('/projects', signal),
  project: (id: string, signal?: AbortSignal) =>
    get<ProjectDetailResponse>(projectPath(id), signal),
  config: (signal?: AbortSignal) =>
    get<GlobalConfigResponse>('/config', signal),
  session: (
    projectId: string,
    sessionId: string,
    page: SessionPageParam | number = 0,
    signal?: AbortSignal,
  ) =>
    get<SessionDetailResponse>(
      `${projectPath(projectId)}/sessions/${encodeURIComponent(sessionId)}?${
        page === 'end'
          ? `from=end&limit=${SESSION_PAGE_SIZE}`
          : typeof page === 'number'
            ? `cursor=${page}&limit=${SESSION_PAGE_SIZE}`
            : `cursor=${page.cursor}&limit=${page.limit}`
      }`,
      signal,
    ),
  sessionPoll: (projectId: string, sessionId: string, signal?: AbortSignal) =>
    get<SessionPollResponse>(
      `${projectPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/status`,
      signal,
    ),
};
export const useOverview = () =>
  useQuery({
    queryKey: ['overview'],
    queryFn: ({ signal }) => api.overview(signal),
    refetchInterval: useLivePolling(),
  });
export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: ({ signal }) => api.projects(signal),
    refetchInterval: useLivePolling(),
  });
export const useProject = (id: string) =>
  useQuery({
    queryKey: ['project', id],
    queryFn: ({ signal }) => api.project(id, signal),
    refetchInterval: useLivePolling(),
  });
export const useConfig = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: ({ signal }) => api.config(signal),
  });
export const useSession = (projectId: string, sessionId: string) => {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['session', projectId, sessionId],
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
      api.session(projectId, sessionId, pageParam, signal),
    getPreviousPageParam: (first) => previousSessionPage(first),
    getNextPageParam: (last) =>
      nextSessionPage(
        last,
        queryClient.getQueryData<SessionPollResponse>([
          'session-poll',
          projectId,
          sessionId,
        ])?.totalMessages,
      ),
  });
  return query;
};
export const useSessionPoll = (projectId: string, sessionId: string) =>
  useQuery({
    queryKey: ['session-poll', projectId, sessionId],
    queryFn: ({ signal }) => api.sessionPoll(projectId, sessionId, signal),
    refetchInterval: useLivePolling(),
  });

export const useHealth = (enabled = true) =>
  useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
    enabled,
    refetchInterval: useLivePolling(),
  });
export const useGlobalSearch = (filters: SearchFilters) =>
  useInfiniteQuery({
    queryKey: ['search', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api.search(filters, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!filters.q.trim(),
    retry: (count, error) =>
      !(error instanceof HttpError && [401, 503].includes(error.status)) &&
      count < 1,
  });

export const useUsage = (filters: UsageFilters) =>
  useQuery({
    queryKey: ['usage', filters],
    queryFn: ({ signal }) => api.usage(filters, signal),
    placeholderData: (previous) => previous,
    refetchInterval: useLivePolling(),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 503) && count < 1,
  });

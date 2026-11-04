import type { StatusHistoryResponse } from '@c9view/api';
import { get } from '../api.js';

export const statusHistory = (
  projectId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<StatusHistoryResponse> =>
  get<StatusHistoryResponse>(
    `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/status/history`,
    signal,
  );

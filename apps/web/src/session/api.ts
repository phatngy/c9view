import type { StatusHistoryResponse } from '@c9view/api';
import { get, machinePath } from '../api.js';

export const statusHistory = (
  machineId: string,
  projectId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<StatusHistoryResponse> =>
  get<StatusHistoryResponse>(
    machinePath(
      machineId,
      `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/status/history`,
    ),
    signal,
  );

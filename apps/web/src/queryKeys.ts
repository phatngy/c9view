import type { MachineId } from '@c9view/api';
import type { SearchFilters, UsageFilters } from './api.js';

export const queryKeys = {
  machines: () => ['machines'] as const,
  hubHealth: () => ['hub-health'] as const,
  overview: (machineId: MachineId) => [machineId, 'overview'] as const,
  projects: (machineId: MachineId) => [machineId, 'projects'] as const,
  project: (machineId: MachineId, projectId: string) =>
    [machineId, 'project', projectId] as const,
  session: (machineId: MachineId, projectId: string, sessionId: string) =>
    [machineId, 'session', projectId, sessionId] as const,
  sessionPoll: (machineId: MachineId, projectId: string, sessionId: string) =>
    [machineId, 'session-poll', projectId, sessionId] as const,
  statusHistory: (machineId: MachineId, projectId: string, sessionId: string) =>
    [machineId, 'status-history', projectId, sessionId] as const,
  config: (machineId: MachineId) => [machineId, 'config'] as const,
  health: (machineId: MachineId) => [machineId, 'health'] as const,
  search: (machineId: MachineId, filters: SearchFilters) =>
    [machineId, 'search', filters] as const,
  usage: (machineId: MachineId, filters: UsageFilters) =>
    [machineId, 'usage', filters] as const,
  files: (machineId: MachineId, projectId: string, path: string) =>
    [machineId, 'files', projectId, path] as const,
  file: (machineId: MachineId, projectId: string, path: string) =>
    [machineId, 'file', projectId, path] as const,
  gitStatus: (machineId: MachineId, projectId: string) =>
    [machineId, 'git-status', projectId] as const,
  gitDiff: (machineId: MachineId, projectId: string, path: string) =>
    [machineId, 'git-diff', projectId, path] as const,
  changes: (machineId: MachineId, projectId: string, sessionId: string) =>
    [machineId, 'changes', projectId, sessionId] as const,
  change: (
    machineId: MachineId,
    projectId: string,
    sessionId: string,
    fileId: string,
  ) => [machineId, 'change', projectId, sessionId, fileId] as const,
};

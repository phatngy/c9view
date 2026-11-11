import { useQuery } from '@tanstack/react-query';
import { HttpError } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { useControl } from './useControl.js';

/** Workspace roots of the current machine; none (404) means "New project" stays hidden. */
export function useWorkspaceRoots() {
  const control = useControl();
  const machineId = useMachineId();
  const query = useQuery({
    queryKey: queryKeys.workspaceRoots(machineId),
    queryFn: ({ signal }) => control.service.workspaceRoots(signal),
    enabled: control.ready,
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
  });
  return {
    roots: control.ready ? (query.data?.roots ?? []) : [],
    control,
  };
}

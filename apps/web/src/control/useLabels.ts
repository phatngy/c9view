import { useQuery } from '@tanstack/react-query';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { useControl } from './useControl.js';

/** c9view labels by `projectId/sessionId`; empty unless control is ready. */
export function useLabels() {
  const control = useControl();
  const machineId = useMachineId();
  const query = useQuery({
    queryKey: queryKeys.labels(machineId),
    queryFn: ({ signal }) => control.service.labels(signal),
    enabled: control.ready,
  });
  const map = new Map<string, string>();
  if (control.ready)
    for (const item of query.data?.labels ?? [])
      map.set(`${item.projectId}/${item.sessionId}`, item.label);
  return {
    labelFor: (projectId: string, sessionId: string) =>
      map.get(`${projectId}/${sessionId}`),
    control,
    machineId,
  };
}

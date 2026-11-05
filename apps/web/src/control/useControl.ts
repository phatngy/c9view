import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { useLivePolling } from '../live/state.js';
import { controlApi } from './api.js';

export function useControl() {
  const machineId = useMachineId();
  const client = useQueryClient();
  const machines = useQuery({
    queryKey: queryKeys.machines(),
    queryFn: ({ signal }) => api.machines(signal),
  });
  const machine = Array.isArray(machines.data)
    ? machines.data.find((item) => item.machineId === machineId)
    : undefined;
  const ready = machine?.capabilities.control.state === 'ready';
  const service = controlApi(machineId, machine?.bootId ?? '');
  const query = useQuery({
    queryKey: queryKeys.controlRuns(machineId),
    queryFn: ({ signal }) => service.runs(signal),
    enabled: ready,
    refetchInterval: useLivePolling(),
  });
  return {
    ...query,
    ready,
    bypass: machine?.capabilities.bypass ?? false,
    machine,
    service,
    refresh: () =>
      client.invalidateQueries({ queryKey: queryKeys.controlRuns(machineId) }),
  };
}

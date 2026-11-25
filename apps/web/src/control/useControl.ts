import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { useLivePolling } from '../live/state.js';
import { controlApi } from './api.js';

/** Same text the node sends with the `api-key-required` refusal. */
export const API_KEY_REQUIRED_MESSAGE =
  "Starting or resuming a session from c9view needs an Anthropic API key (ANTHROPIC_API_KEY) or a cloud provider (CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX, CLAUDE_CODE_USE_FOUNDRY or CLAUDE_CODE_USE_ANTHROPIC_AWS). c9view does not use claude.ai subscription login (Anthropic's Agent SDK policy).";

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
    apiKeyRequired:
      machine?.capabilities.control.sdkAuth === 'api-key-required',
    bypass: machine?.capabilities.bypass ?? false,
    machine,
    service,
    refresh: () =>
      client.invalidateQueries({ queryKey: queryKeys.controlRuns(machineId) }),
  };
}

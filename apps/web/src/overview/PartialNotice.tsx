import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { queryKeys } from '../queryKeys.js';

/** Text notice for a merged response (7a): machines left out or counted from a snapshot. */
export function PartialNotice({
  partial,
  offline,
}: {
  partial?: string[] | undefined;
  offline?: string[] | undefined;
}) {
  const missing = partial ?? [];
  const stale = offline ?? [];
  const machines = useQuery({
    queryKey: queryKeys.machines(),
    queryFn: ({ signal }) => api.machines(signal),
    enabled: missing.length + stale.length > 0,
  });
  if (!missing.length && !stale.length) return null;
  const names = new Map(
    (Array.isArray(machines.data) ? machines.data : []).map((m) => [
      m.machineId,
      m.name,
    ]),
  );
  const list = (ids: string[]) =>
    ids.map((id) => names.get(id) ?? id).join(', ');
  return (
    <div role="status" className="panel text-sm" data-testid="partial-notice">
      {missing.length > 0 && (
        <p>
          Partial results: {list(missing)} did not answer in time, so{' '}
          {missing.length === 1 ? 'its' : 'their'} data is missing here.
        </p>
      )}
      {stale.length > 0 && (
        <p>
          Offline: {list(stale)}. Showing the last known projects and sessions;
          usage history is not included.
        </p>
      )}
    </div>
  );
}

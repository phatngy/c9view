import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowUp, Folder } from 'lucide-react';
import { Button } from '../kit/index.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { useControl } from './useControl.js';

/**
 * Lists only directories under the machine's workspace roots, one level at a
 * time. Every navigation reports its folder so the path field stays in sync.
 */
export function FolderPicker({
  onChange,
  initial,
}: {
  onChange: (path: string) => void;
  initial?: string;
}) {
  const control = useControl();
  const machineId = useMachineId();
  const [path, setPath] = useState(initial ?? '');
  const [hidden, setHidden] = useState(false);
  const listing = useQuery({
    queryKey: queryKeys.workspaceBrowse(machineId, path, hidden),
    queryFn: ({ signal }) =>
      control.service.browse(path || undefined, hidden, signal),
    enabled: control.ready,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const go = (next: string) => {
    setPath(next);
    onChange(next);
  };
  const data = listing.data;
  return (
    <section
      aria-label="Folder picker"
      className="space-y-2 rounded-lg border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={ArrowUp}
          disabled={!data?.path}
          aria-label="Up one level"
          onClick={() => go(data?.parent ?? '')}
        >
          Up
        </Button>
        <p className="min-w-0 flex-1 break-all font-mono text-xs text-muted">
          {data?.path ?? 'Workspace roots'}
        </p>
        <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-0">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => setHidden(event.target.checked)}
          />
          Show hidden
        </label>
      </div>
      {listing.isError && (
        <p role="alert" className="text-sm text-danger">
          Could not list this folder.
        </p>
      )}
      <ul
        aria-label={data?.path ? `Folders in ${data.path}` : 'Workspace roots'}
        className="max-h-48 space-y-1 overflow-y-auto"
      >
        {data?.entries.map((entry) => (
          <li key={entry.path}>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => go(entry.path)}
            >
              <Folder size={16} aria-hidden="true" />
              <span className="truncate">{entry.name}</span>
            </Button>
          </li>
        ))}
        {data && data.entries.length === 0 && (
          <li className="text-sm text-muted">No folders here.</li>
        )}
      </ul>
      {data?.truncated && (
        <p className="text-xs text-muted">Only the first folders are shown.</p>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { PermissionMode, TrustSummary } from '@c9view/api';
import { Button, Dialog, Select } from '../kit/index.js';
import { focusRing } from '../kit/classes.js';
import { api, HttpError } from '../api.js';
import { MachineContext, useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { ControlError, unknownOutcome } from './api.js';
import { BypassBadge } from './BypassBadge.js';
import { FolderPicker } from './FolderPicker.js';
import { useControl } from './useControl.js';

const LIMIT = 20_000;
// A clone may take up to the node's 10-minute limit. The node keeps a `cloning`
// receipt until its status changes, then for 10 minutes; this is the UI's own wait cap.
const WAIT_LIMIT = 11 * 60_000;
const modes = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan' },
];
const field =
  'min-h-11 w-full rounded-md border border-line bg-raised px-3 font-normal text-ink';

export function NewProjectDialog({
  open,
  onOpenChange,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const current = useMachineId();
  const [machine, setMachine] = useState(current);
  const machines = useQuery({
    queryKey: queryKeys.machines(),
    queryFn: ({ signal }) => api.machines(signal),
  });
  const ready = (Array.isArray(machines.data) ? machines.data : []).filter(
    (item) => item.capabilities.control.state === 'ready',
  );
  /* eslint-disable react-hooks/set-state-in-effect -- Start from the current machine each time the controlled dialog opens. */
  useEffect(() => {
    if (open) setMachine(current);
  }, [open, current]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="Create a folder, open an existing one or clone a repository under a workspace root, then start its first session."
      {...(finalFocus ? { finalFocus } : {})}
      className="max-h-[min(90dvh,48rem)] overflow-y-auto"
    >
      <MachineContext value={machine}>
        <ProjectForm
          key={`${machine}:${open}`}
          open={open}
          onOpenChange={onOpenChange}
          machineField={
            ready.length > 1 ? (
              <Select
                label="Machine"
                options={ready.map((item) => ({
                  value: item.machineId,
                  label: item.name,
                }))}
                value={machine}
                onValueChange={setMachine}
              />
            ) : null
          }
        />
      </MachineContext>
    </Dialog>
  );
}

function ProjectForm({
  open,
  onOpenChange,
  machineField,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineField: React.ReactNode;
}) {
  const control = useControl();
  const machineId = useMachineId();
  const navigate = useNavigate();
  const [location, setLocation] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [gitInit, setGitInit] = useState(true);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<PermissionMode>('default');
  const [browsing, setBrowsing] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [trust, setTrust] = useState<TrustSummary>();
  const [waiting, setWaiting] = useState<{
    id: string;
    operation: 'project' | 'trust';
  }>();
  const waitingSince = useRef(0);
  const receipt = useQuery({
    queryKey: queryKeys.controlReceipt(machineId, waiting?.id ?? ''),
    queryFn: ({ signal }) => control.service.receipt(waiting!.id, signal),
    enabled: !!waiting && control.ready,
    retry: false,
    refetchInterval: (query) =>
      query.state.error instanceof HttpError && query.state.error.status === 404
        ? false
        : Date.now() - waitingSince.current >= WAIT_LIMIT
          ? false
          : 2000,
  });
  const draft = useRef({ location, gitUrl, gitInit, name, text, mode });

  function goToSession(projectId: string, sessionId: string) {
    onOpenChange(false);
    void navigate({
      to: '/m/$machineId/projects/$projectId/sessions/$sessionId',
      params: { machineId, projectId, sessionId },
      search: { newSession: true },
    });
  }
  function wait(id: string, operation: 'project' | 'trust') {
    waitingSince.current = Date.now();
    setWaiting({ id, operation });
  }

  /** `clone` sends the URL; the follow-up after a clone opens the folder as is. */
  async function submit(clone: boolean, retry = false) {
    if (!control.ready || (!retry && (pending || waiting))) return;
    const d = retry
      ? draft.current
      : { location, gitUrl, gitInit, name, text, mode };
    if (!d.location.trim()) {
      setNotice('Enter a location inside a workspace root.');
      return;
    }
    if (!d.text.trim() || d.text.length > LIMIT) return;
    draft.current = d;
    setPending(true);
    setTrust(undefined);
    const url = d.gitUrl.trim();
    setNotice(clone && url ? 'Cloning repository…' : 'Preparing the project…');
    try {
      const value = await control.service.newProject({
        location: d.location.trim(),
        ...(clone && url
          ? { gitUrl: url }
          : !url
            ? { gitInit: d.gitInit }
            : {}),
        text: d.text,
        ...(d.name.trim() ? { name: d.name.trim() } : {}),
        permissionMode: d.mode,
      });
      if (value.status === 'failed')
        setNotice(value.error ?? 'Could not create the project.');
      else if (value.status === 'cloning') {
        setNotice('Cloning repository… this can take a few minutes.');
        wait(value.clientRequestId, 'project');
      } else if (value.sessionId && value.projectId)
        goToSession(value.projectId, value.sessionId);
      else setNotice(unknownOutcome);
    } catch (error) {
      if (error instanceof ControlError && error.kind === 'uncertain') {
        setNotice('This may have been sent. Checking its receipt…');
        wait(error.clientRequestId, 'project');
      } else {
        if (error instanceof ControlError && error.trust) setTrust(error.trust);
        setNotice(message(error));
      }
    } finally {
      setPending(false);
    }
  }

  async function trustFolder() {
    if (!trust || pending) return;
    setPending(true);
    try {
      const result = await control.service.trust(trust.path, trust.fingerprint);
      if (result.status === 'failed') {
        setNotice(result.error ?? 'Could not trust this folder.');
        return;
      }
      setTrust(undefined);
      await submit(false, true);
    } catch (error) {
      if (error instanceof ControlError && error.kind === 'uncertain') {
        setNotice('Trust may have been sent. Checking its receipt…');
        wait(error.clientRequestId, 'trust');
      } else setNotice(message(error));
    } finally {
      setPending(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- Synchronize an in-flight command with its receipt. */
  useEffect(() => {
    if (!open || !waiting) return;
    const value = receipt.data;
    if (value) {
      if (value.status === 'failed') {
        setNotice(value.error ?? 'Could not create the project.');
        setWaiting(undefined);
      } else if (value.status === 'ready' && waiting.operation === 'project') {
        // Cloned: the next step is the trust gate, never an automatic trust.
        setWaiting(undefined);
        void submit(false, true);
      } else if (value.status === 'done' && waiting.operation === 'trust') {
        setWaiting(undefined);
        void submit(false, true);
      } else if (
        value.sessionId &&
        value.projectId &&
        waiting.operation === 'project'
      )
        goToSession(value.projectId, value.sessionId);
    } else if (
      receipt.error instanceof HttpError &&
      receipt.error.status === 404
    ) {
      setNotice(unknownOutcome);
      setWaiting(undefined);
    }
    // Receipt lookup is the only recovery after a possibly committed POST.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, receipt.data, receipt.error, waiting]);
  useEffect(() => {
    if (!open || !waiting) return;
    const timer = window.setTimeout(
      () => {
        setNotice(
          'This may have been sent. Check the project list before sending again.',
        );
        setWaiting(undefined);
      },
      Math.max(0, WAIT_LIMIT - (Date.now() - waitingSince.current)),
    );
    return () => window.clearTimeout(timer);
  }, [open, waiting]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const cloning = !!waiting && waiting.operation === 'project';
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
    >
      {control.bypass && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
          <BypassBadge />
          <p className="mt-2 text-muted">
            This machine bypasses permission prompts for every run.
          </p>
        </div>
      )}
      {machineField}
      <div className="space-y-1.5">
        <label
          className="block text-sm font-medium"
          htmlFor="new-project-location"
        >
          Location{' '}
          <span aria-hidden="true" className="text-danger">
            *
          </span>
        </label>
        <div className="flex gap-2">
          <input
            id="new-project-location"
            required
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="/path/under/a/workspace/root"
            className={`${focusRing} ${field} font-mono text-sm`}
          />
          <Button
            aria-expanded={browsing}
            onClick={() => setBrowsing(!browsing)}
          >
            Browse…
          </Button>
        </div>
        {browsing && <FolderPicker onChange={setLocation} initial="" />}
      </div>
      <label
        className="block space-y-1.5 text-sm font-medium"
        htmlFor="new-project-url"
      >
        Git URL <span className="font-normal text-muted">(optional)</span>
        <input
          id="new-project-url"
          value={gitUrl}
          onChange={(event) => setGitUrl(event.target.value)}
          placeholder="https://host/owner/repo.git or git@host:owner/repo.git"
          className={`${focusRing} ${field} font-mono text-sm`}
        />
        <span className="block text-xs font-normal text-muted">
          https and ssh only, using your own credentials. The folder must be
          missing or empty.
        </span>
      </label>
      {!gitUrl.trim() && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={gitInit}
            onChange={(event) => setGitInit(event.target.checked)}
          />
          Initialize git
        </label>
      )}
      <label
        className="block space-y-1.5 text-sm font-medium"
        htmlFor="new-project-prompt"
      >
        First prompt{' '}
        <span aria-hidden="true" className="text-danger">
          *
        </span>
        <textarea
          id="new-project-prompt"
          required
          maxLength={LIMIT}
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, LIMIT))}
          className={`${focusRing} min-h-28 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 font-normal text-ink`}
        />
      </label>
      <label
        className="block space-y-1.5 text-sm font-medium"
        htmlFor="new-project-name"
      >
        Session name <span className="font-normal text-muted">(optional)</span>
        <input
          id="new-project-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
          className={`${focusRing} ${field}`}
        />
      </label>
      <Select
        label="Permission mode"
        options={modes}
        value={mode}
        onValueChange={(value) => setMode(value as PermissionMode)}
      />
      {trust && (
        <section
          className="space-y-2 rounded-lg border border-line bg-surface p-3"
          aria-label="Folder trust required"
        >
          <p className="font-medium">Trust this folder before starting</p>
          <p className="break-all font-mono text-xs text-muted">{trust.path}</p>
          <p className="text-sm text-muted">
            Hooks: {trust.hooks.join(', ') || 'None'}
          </p>
          <p className="text-sm text-muted">
            MCP servers: {trust.mcpServers.join(', ') || 'None'}
          </p>
          <p className="text-sm text-muted">
            Allow rules: {trust.allowRules.join(', ') || 'None'}
          </p>
          <p className="text-sm text-muted">
            Plugins: {trust.plugins.join(', ') || 'None'}
          </p>
          <p className="text-sm text-muted">
            CLAUDE.md: {trust.hasClaudeMd ? 'Present' : 'Not present'}
          </p>
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => void trustFolder()}
          >
            Trust this folder
          </Button>
        </section>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button disabled={pending} onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={
            pending || cloning || !!trust || !text.trim() || !location.trim()
          }
        >
          {pending || cloning ? 'Working…' : 'Create and start'}
        </Button>
      </div>
    </form>
  );
}

function message(error: unknown) {
  if (error instanceof ControlError) {
    if (error.reason === 'unknown-outcome') return unknownOutcome;
    if (error.reason === 'outside-roots')
      return 'That location is outside the workspace roots.';
    if (error.reason === 'bad-url')
      return 'Enter an https:// or ssh:// git URL, or user@host:path.';
    if (error.reason === 'not-empty')
      return 'That folder is not empty; pick a missing or empty folder to clone into.';
    if (error.reason === 'run-exists')
      return 'A run is already starting for that folder. Wait for it to finish, then try again.';
    if (error.reason === 'bypass-not-allowed')
      return 'This permission mode is not allowed on the selected machine.';
  }
  return error instanceof Error ? error.message : 'Request failed.';
}

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { PermissionMode, TrustSummary } from '@c9view/api';
import { Button, Select, Dialog } from '../kit/index.js';
import { focusRing } from '../kit/classes.js';
import { HttpError } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { ControlError, unknownOutcome } from './api.js';
import { BypassBadge } from './BypassBadge.js';
import { useControl } from './useControl.js';

const LIMIT = 20_000;
const modes = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'plan', label: 'Plan' },
];

export function NewSessionDialog({
  projectId,
  open,
  onOpenChange,
  finalFocus,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const control = useControl();
  const machineId = useMachineId();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<PermissionMode>('default');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [trust, setTrust] = useState<TrustSummary>();
  const [waitingId, setWaitingId] = useState('');
  const [waitingOperation, setWaitingOperation] = useState<'start' | 'trust'>(
    'start',
  );
  const attempted = useRef({
    text: '',
    name: '',
    mode: 'default' as PermissionMode,
  });
  const poll = useRef(0);
  const receipt = useQuery({
    queryKey: queryKeys.controlReceipt(machineId, waitingId),
    queryFn: ({ signal }) => control.service.receipt(waitingId, signal),
    enabled: !!waitingId && control.ready,
    retry: false,
    refetchInterval: (query) =>
      query.state.error instanceof HttpError && query.state.error.status === 404
        ? false
        : Math.min(1000 * 2 ** Math.max(0, poll.current++), 10_000),
  });

  useEffect(() => {
    if (!open) return;
    // Reset the controlled dialog draft each time it opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText('');
    setName('');
    setMode('default');
    setNotice('');
    setTrust(undefined);
    poll.current = 0;
  }, [open]);

  function goToSession(sessionId: string) {
    onOpenChange(false);
    void navigate({
      to: '/m/$machineId/projects/$projectId/sessions/$sessionId',
      params: { machineId, projectId, sessionId },
    });
  }

  async function submit(retry = false, trusted = false) {
    if ((pending && !trusted) || (waitingId && !trusted) || !control.ready)
      return;
    const draft = retry ? attempted.current : { text, name, mode };
    if (!draft.text.trim() || draft.text.length > LIMIT) return;
    attempted.current = draft;
    setPending(true);
    setNotice('Starting session…');
    setTrust(undefined);
    try {
      const value = await control.service.newSession(projectId, {
        text: draft.text,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        permissionMode: draft.mode,
      });
      if (value.status === 'failed') {
        setNotice(value.error ?? 'Could not start the session.');
        return;
      }
      if (!value.sessionId) {
        setNotice(unknownOutcome);
        return;
      }
      goToSession(value.sessionId);
    } catch (error) {
      if (error instanceof ControlError && error.kind === 'uncertain') {
        setNotice('This may have been sent. Checking its receipt…');
        setWaitingOperation('start');
        setWaitingId(error.clientRequestId);
      } else {
        if (error instanceof ControlError && error.reason === 'unknown-outcome')
          setNotice(unknownOutcome);
        else if (
          error instanceof ControlError &&
          error.reason === 'bypass-not-allowed'
        )
          setNotice(
            'This permission mode is not allowed on the selected machine.',
          );
        else
          setNotice(error instanceof Error ? error.message : 'Request failed.');
        if (error instanceof ControlError && error.trust) setTrust(error.trust);
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
      await submit(true, true);
    } catch (error) {
      if (error instanceof ControlError && error.kind === 'uncertain') {
        setNotice('Trust may have been sent. Checking its receipt…');
        setWaitingOperation('trust');
        setWaitingId(error.clientRequestId);
      } else
        setNotice(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setPending(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- Synchronize an uncertain command with the external receipt query. */
  useEffect(() => {
    if (!waitingId) return;
    if (receipt.data) {
      const value = receipt.data;
      if (value.status === 'failed') {
        setNotice(value.error ?? 'Could not start the session.');
        setWaitingId('');
      } else if (waitingOperation === 'trust' && value.status === 'done') {
        setWaitingId('');
        setTrust(undefined);
        void submit(true, true);
      } else if (waitingOperation === 'start' && value.sessionId)
        goToSession(value.sessionId);
    } else if (
      receipt.error instanceof HttpError &&
      receipt.error.status === 404
    ) {
      setNotice(unknownOutcome);
      setWaitingId('');
    }
    // Receipt lookup is the only recovery after a possibly committed POST.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.data, receipt.error, waitingId, waitingOperation]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New session"
      description="Start a Claude Code session in this project."
      {...(finalFocus ? { finalFocus } : {})}
      className="max-h-[min(90dvh,48rem)] overflow-y-auto"
    >
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
        <label
          className="block space-y-1.5 text-sm font-medium"
          htmlFor="new-session-prompt"
        >
          Prompt{' '}
          <span aria-hidden="true" className="text-danger">
            *
          </span>
          <textarea
            id="new-session-prompt"
            required
            minLength={1}
            maxLength={LIMIT}
            rows={7}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, LIMIT))}
            className={`${focusRing} min-h-36 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 font-normal text-ink`}
          />
        </label>
        <p className="-mt-3 text-right text-xs text-muted" aria-live="polite">
          {text.length.toLocaleString()} / {LIMIT.toLocaleString()}
        </p>
        <label
          className="block space-y-1.5 text-sm font-medium"
          htmlFor="new-session-name"
        >
          Name <span className="font-normal text-muted">(optional)</span>
          <input
            id="new-session-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value.slice(0, 80))}
            className={`${focusRing} min-h-11 w-full rounded-md border border-line bg-raised px-3 font-normal text-ink`}
          />
          <span className="block text-xs font-normal text-muted">
            Up to 80 characters.
          </span>
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
            <p className="break-all font-mono text-xs text-muted">
              {trust.path}
            </p>
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
          <Button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !!waitingId || !text.trim()}
          >
            {pending ? 'Starting…' : 'Start session'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

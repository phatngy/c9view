import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { CommandReceipt, PermissionMode, TrustSummary } from '@c9view/api';
import { Button, Select } from '../kit/index.js';
import { focusRing } from '../kit/classes.js';
import { HttpError } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { ControlError, unknownOutcome } from './api.js';
import { controlKeys, useControl } from './useControl.js';
import {
  BypassBadge,
  PermissionCard,
  QuestionCard,
  TrustCard,
} from './cards.js';
import { RunBar } from './RunBar.js';

type Waiting = {
  id: string;
  fork: boolean;
  operation: 'reply' | 'trust' | 'action';
};
export function Composer({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const control = useControl();
  const machineId = useMachineId();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [trust, setTrust] = useState<TrustSummary>();
  const [changed, setChanged] = useState(false);
  const [waiting, setWaiting] = useState<Waiting>();
  const actionLock = useRef(false);
  const recovery = useRef<
    { resolve: () => void; reject: (error: Error) => void } | undefined
  >(undefined);
  const attempted = useRef({ text: '', fork: false });
  const runs = control.ready
    ? (control.data?.runs.filter(
        (run) => run.projectId === projectId && run.sessionId === sessionId,
      ) ?? [])
    : [];
  const run =
    runs.find((item) => !['ended', 'failed'].includes(item.state)) ??
    runs.at(-1);
  const requests = control.ready
    ? (control.data?.requests.filter(
        (request) =>
          request.sessionId === sessionId &&
          runs.some((item) => item.runId === request.runId),
      ) ?? [])
    : [];
  const announcement = requests.length
    ? `${requests.length} pending ${requests.length === 1 ? 'request' : 'requests'} from Claude. ${requests.map((request) => (request.kind === 'permission' ? request.summary : request.questions.map((question) => question.header).join(', '))).join('; ')}`
    : '';
  const receipt = useQuery({
    queryKey: controlKeys.receipt(machineId, waiting?.id ?? ''),
    queryFn: ({ signal }) => control.service.receipt(waiting!.id, signal),
    enabled: !!waiting && control.ready,
    retry: false,
    refetchInterval: (query) =>
      query.state.error instanceof HttpError && query.state.error.status === 404
        ? false
        : 1000,
  });
  function refresh() {
    void control.refresh();
  }
  function outcome(value: CommandReceipt, fork: boolean) {
    refresh();
    if (value.status === 'failed') {
      setNotice(value.error ?? 'Command failed.');
      setWaiting(undefined);
      return;
    }
    if (fork && (!value.sessionId || value.sessionId === sessionId)) {
      setNotice('Starting fork…');
      setWaiting({ id: value.clientRequestId, fork, operation: 'reply' });
      return;
    }
    setWaiting(undefined);
    setText('');
    setConflict(false);
    setTrust(undefined);
    setNotice('Queued');
    if (fork && value.sessionId)
      void navigate({
        to: '/m/$machineId/projects/$projectId/sessions/$sessionId',
        params: {
          machineId,
          projectId: value.projectId ?? projectId,
          sessionId: value.sessionId,
        },
      });
  }
  function failure(
    error: unknown,
    operation: Waiting['operation'],
    fork = false,
  ) {
    refresh();
    if (error instanceof ControlError) {
      if (error.kind === 'uncertain') {
        setNotice('This may have been sent');
        setWaiting({ id: error.clientRequestId, fork, operation });
        return;
      }
      if (error.reason === 'unknown-outcome')
        void client.invalidateQueries({ queryKey: queryKeys.machines() });
      if (['live-elsewhere', 'liveness-unknown'].includes(error.reason ?? ''))
        setConflict(true);
      if (error.trust) {
        setTrust(error.trust);
        setChanged(error.reason === 'settings-changed');
      }
    }
    setNotice(error instanceof Error ? error.message : 'Request failed.');
  }
  async function send(fork = false, retry = false) {
    if (busy.current || actionLock.current || waiting || !control.ready) return;
    const draft = retry ? attempted.current.text : text;
    if (!draft.trim()) return;
    attempted.current = { text: draft, fork };
    busy.current = true;
    setPending(true);
    setNotice('Sending…');
    setConflict(false);
    try {
      outcome(
        await control.service.reply(projectId, sessionId, draft, fork),
        fork,
      );
    } catch (error) {
      failure(error, 'reply', fork);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function trustFolder() {
    if (!trust || busy.current || waiting) return;
    busy.current = true;
    setPending(true);
    try {
      try {
        const value = await control.service.trust(
          trust.path,
          trust.fingerprint,
        );
        if (value.status === 'failed')
          throw new Error(value.error ?? 'Could not trust folder.');
      } catch (error) {
        failure(error, 'trust');
        if (error instanceof ControlError && error.kind === 'uncertain') {
          await new Promise<void>((resolve, reject) => {
            recovery.current = { resolve, reject };
          });
        } else throw error;
      }
      setTrust(undefined);
      busy.current = false;
      await send(attempted.current.fork, true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  // A receipt read is the only automatic recovery; never resend an uncertain mutation.
  /* eslint-disable react-hooks/set-state-in-effect -- Synchronize the pending command with its receipt read. */
  useEffect(() => {
    if (!waiting) return;
    const value = receipt.data;
    if (!value && !receipt.error) return;
    if (receipt.error) {
      if (receipt.error instanceof HttpError && receipt.error.status === 404) {
        recovery.current?.reject(new Error(unknownOutcome));
        recovery.current = undefined;
        setNotice(unknownOutcome);
        setWaiting(undefined);
        void client.invalidateQueries({ queryKey: queryKeys.machines() });
        refresh();
      }
      return;
    }
    if (!value) return;
    if (value.status === 'failed') {
      recovery.current?.reject(new Error(value.error ?? 'Command failed.'));
      recovery.current = undefined;
      setNotice(value.error ?? 'Command failed.');
      setWaiting(undefined);
      refresh();
      return;
    }
    if (waiting.operation === 'trust' && value.status !== 'done') return;
    if (waiting.operation === 'reply') outcome(value, waiting.fork);
    else if (waiting.operation === 'trust') {
      setWaiting(undefined);
      setTrust(undefined);
      recovery.current?.resolve();
      recovery.current = undefined;
    } else {
      setWaiting(undefined);
      recovery.current?.resolve();
      recovery.current = undefined;
      setNotice('Command received.');
      refresh();
    }
    // React to receipt changes, not changing service objects from render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.data, receipt.error, waiting?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  async function action(task: () => Promise<CommandReceipt>) {
    if (actionLock.current || busy.current || waiting)
      throw new Error('Another command is pending.');
    actionLock.current = true;
    setPending(true);
    try {
      const value = await task();
      if (value.status === 'failed')
        throw new Error(value.error ?? 'Command failed.');
      refresh();
    } catch (error) {
      failure(error, 'action');
      if (error instanceof ControlError && error.kind === 'uncertain') {
        // Keep the card locked until GET confirms its outcome.
        await new Promise<void>((resolve, reject) => {
          recovery.current = { resolve, reject };
        });
      } else throw error;
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }
  if (!control.ready) return null;
  return (
    <div
      className="sticky bottom-0 z-1 max-h-[60dvh] flex-none space-y-3 overflow-y-auto border-t border-line bg-page p-3"
      aria-label="Session control"
    >
      {run && (
        <RunBar
          run={run}
          onInterrupt={() => action(() => control.service.interrupt(run.runId))}
          onStop={() => action(() => control.service.stop(run.runId))}
        />
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {control.error && (
        <p role="alert">
          Could not refresh run controls: {control.error.message}
        </p>
      )}
      {requests.map((request) =>
        request.kind === 'permission' ? (
          <PermissionCard
            key={request.requestId}
            request={request}
            layout="pinned"
            onDecide={(decision) =>
              action(() => control.service.decide(request.requestId, decision))
            }
          />
        ) : (
          <QuestionCard
            key={request.requestId}
            request={request}
            layout="pinned"
            onDecide={(decision) =>
              action(() => control.service.decide(request.requestId, decision))
            }
          />
        ),
      )}
      {trust && (
        <TrustCard
          trust={trust}
          changed={changed}
          onTrust={trustFolder}
          onCancel={() => {
            setTrust(undefined);
            setNotice('');
          }}
        />
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="space-y-2"
      >
        <label htmlFor="session-reply" className="block text-sm font-medium">
          Reply to session
        </label>
        <textarea
          id="session-reply"
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 20_000))}
          maxLength={20_000}
          rows={3}
          disabled={pending || !!waiting || !!trust}
          aria-describedby="reply-count reply-status"
          className={`block max-h-48 min-h-22 w-full resize-y rounded-md border border-line bg-raised p-3 text-ink ${focusRing}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          {control.bypass ? (
            <BypassBadge />
          ) : (
            <Select
              label="Permission mode"
              value={
                run?.mode === 'bypassPermissions'
                  ? 'default'
                  : (run?.mode ?? 'default')
              }
              options={[
                { value: 'default', label: 'Default' },
                { value: 'acceptEdits', label: 'Accept edits' },
                { value: 'plan', label: 'Plan' },
              ]}
              disabled={!run || pending || !!waiting}
              onValueChange={(value) => {
                if (run)
                  void action(() =>
                    control.service.mode(run.runId, value as PermissionMode),
                  ).catch(() => {});
              }}
            />
          )}
          <span id="reply-count" className="text-xs text-muted">
            {text.length.toLocaleString()} / 20,000
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={!text.trim() || pending || !!waiting || !!trust}
          >
            Send
          </Button>
          {conflict && (
            <Button
              disabled={pending || !!waiting}
              onClick={() => void send(true, true)}
            >
              Fork and reply
            </Button>
          )}
        </div>
        <p id="reply-status" role="status" aria-live="polite">
          {notice}
        </p>
      </form>
    </div>
  );
}

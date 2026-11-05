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
import { useControl } from './useControl.js';
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
  startedAt: number;
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
  const mounted = useRef(true);
  const container = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const previousRequests = useRef<string[]>([]);
  const focusRequested = useRef<'card' | 'composer' | undefined>(undefined);
  const focusEpoch = useRef(0);
  const focusedRequest = useRef<string | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  const pollAttempt = useRef(0);
  const recovery = useRef<{ resolve: (error?: Error) => void } | undefined>(
    undefined,
  );
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
    queryKey: queryKeys.controlReceipt(machineId, waiting?.id ?? ''),
    queryFn: ({ signal }) => {
      pollAttempt.current += 1;
      return control.service.receipt(waiting!.id, signal);
    },
    enabled: !!waiting && control.ready,
    retry: false,
    refetchInterval: (query) =>
      query.state.error instanceof HttpError && query.state.error.status === 404
        ? false
        : Math.min(1000 * 2 ** Math.max(0, pollAttempt.current - 1), 10_000),
  });
  function focusNext(target: 'card' | 'composer' = 'card') {
    focusRequested.current = target;
  }
  function beginWaiting(value: Omit<Waiting, 'startedAt'>) {
    if (waiting?.id === value.id) return;
    pollAttempt.current = 0;
    setElapsed(0);
    setWaiting((current) =>
      current?.id === value.id ? current : { ...value, startedAt: Date.now() },
    );
  }
  function stopWaiting() {
    recovery.current?.resolve(new Error(unknownOutcome));
    recovery.current = undefined;
    setWaiting(undefined);
    setTrust(undefined);
    if (waiting?.fork) setConflict(true);
    setNotice(`This may have been sent. ${unknownOutcome}`);
    focusNext(waiting?.operation === 'reply' ? 'composer' : 'card');
    void client.invalidateQueries({ queryKey: queryKeys.machines() });
    refresh();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recovery.current?.resolve(new Error(unknownOutcome));
      recovery.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (!waiting) return;
    const update = () =>
      setElapsed(Math.floor((Date.now() - waiting.startedAt) / 1000));
    const ticker = window.setInterval(update, 1000);
    const deadline = window.setTimeout(
      stopWaiting,
      Math.max(0, 120_000 - (Date.now() - waiting.startedAt)),
    );
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(deadline);
      void client.cancelQueries({
        queryKey: queryKeys.controlReceipt(machineId, waiting.id),
      });
    };
    // Keep the original deadline even as the node disconnects and returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting?.id, client, machineId]);
  useEffect(() => {
    const ids = requests.map((request) => request.requestId);
    if (
      focusedRequest.current &&
      previousRequests.current.includes(focusedRequest.current) &&
      !ids.includes(focusedRequest.current)
    ) {
      focusedRequest.current = undefined;
      focusNext();
    }
    previousRequests.current = ids;
  });
  useEffect(() => {
    if (!focusRequested.current || pending || waiting) return;
    const target = focusRequested.current;
    focusRequested.current = undefined;
    const active = document.activeElement;
    // Recovery can finish while the user is typing elsewhere. Only restore
    // focus when its previous control was removed or disabled by the action.
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected &&
      !active.matches(':disabled')
    )
      return;
    const next =
      target === 'card'
        ? container.current?.querySelector<HTMLElement>(
            '[data-control-request] [role="region"][tabindex="-1"]',
          )
        : undefined;
    (next ?? composer.current)?.focus();
  });
  function refresh() {
    void control.refresh();
  }
  function outcome(value: CommandReceipt, fork: boolean) {
    refresh();
    if (value.status === 'failed') {
      setNotice(value.error ?? 'Command failed.');
      setWaiting(undefined);
      focusNext('composer');
      return;
    }
    if (fork && (!value.sessionId || value.sessionId === sessionId)) {
      setNotice('Starting fork…');
      beginWaiting({ id: value.clientRequestId, fork, operation: 'reply' });
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
        beginWaiting({ id: error.clientRequestId, fork, operation });
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
    focusNext(operation === 'reply' ? 'composer' : 'card');
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
          if (!mounted.current)
            throw new Error(unknownOutcome, { cause: error });
          const recoveryError = await new Promise<Error | undefined>(
            (resolve) => {
              recovery.current = { resolve };
            },
          );
          if (recoveryError) throw recoveryError;
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
        recovery.current?.resolve(new Error(unknownOutcome));
        recovery.current = undefined;
        setNotice(unknownOutcome);
        setWaiting(undefined);
        focusNext(waiting.operation === 'reply' ? 'composer' : 'card');
        void client.invalidateQueries({ queryKey: queryKeys.machines() });
        refresh();
      }
      return;
    }
    if (!value) return;
    if (value.status === 'failed') {
      recovery.current?.resolve(new Error(value.error ?? 'Command failed.'));
      recovery.current = undefined;
      setNotice(value.error ?? 'Command failed.');
      setWaiting(undefined);
      focusNext(waiting.operation === 'reply' ? 'composer' : 'card');
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
        if (!mounted.current) throw new Error(unknownOutcome, { cause: error });
        // Keep the card locked until GET confirms its outcome.
        const recoveryError = await new Promise<Error | undefined>(
          (resolve) => {
            recovery.current = { resolve };
          },
        );
        if (recoveryError) throw recoveryError;
      } else throw error;
    } finally {
      actionLock.current = false;
      setPending(false);
    }
  }
  if (!control.ready) return null;
  return (
    <div
      ref={container}
      onBlurCapture={(event) => {
        if (event.relatedTarget instanceof HTMLElement) {
          if (!event.relatedTarget.closest('[data-control-request]'))
            focusedRequest.current = undefined;
          return;
        }
        const target = event.target as HTMLElement;
        const requestId = focusedRequest.current;
        const epoch = focusEpoch.current;
        // Browsers can blur a control when React removes or disables it. Keep
        // its card identity until the removal effect can move focus forward.
        queueMicrotask(() => {
          if (
            focusEpoch.current !== epoch ||
            focusedRequest.current !== requestId
          )
            return;
          if (target.isConnected && !target.matches(':disabled'))
            focusedRequest.current = undefined;
        });
      }}
      onFocusCapture={(event) => {
        focusEpoch.current += 1;
        focusedRequest.current = (
          event.target as HTMLElement
        ).closest<HTMLElement>('[data-control-request]')?.dataset
          .controlRequest;
      }}
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
      {requests.map((request) => (
        <div key={request.requestId} data-control-request={request.requestId}>
          {request.kind === 'permission' ? (
            <PermissionCard
              key={request.requestId}
              request={request}
              layout="pinned"
              onDecide={(decision) =>
                action(() =>
                  control.service.decide(request.requestId, decision),
                )
              }
            />
          ) : (
            <QuestionCard
              key={request.requestId}
              request={request}
              layout="pinned"
              onDecide={(decision) =>
                action(() =>
                  control.service.decide(request.requestId, decision),
                )
              }
            />
          )}
        </div>
      ))}
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
          ref={composer}
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
        {waiting && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status">Still checking whether it was sent…</p>
            <span aria-hidden="true">{elapsed}s elapsed</span>
            <Button onClick={stopWaiting}>Stop waiting</Button>
          </div>
        )}
        <p id="reply-status" role="status" aria-live="polite">
          {notice}
        </p>
      </form>
    </div>
  );
}

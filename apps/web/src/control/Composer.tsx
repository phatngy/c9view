import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ClipboardList,
  Pencil,
  SendHorizontal,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CommandReceipt,
  PermissionMode,
  SessionStatus,
  TrustSummary,
} from '@c9view/api';
import { Button, Select } from '../kit/index.js';
import { focusRing, target as targetSize } from '../kit/classes.js';
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
import { currentRun, isActiveRun } from './runState.js';
import {
  addRemoteCommand,
  useRemoteAvailability,
  useRemoteCommands,
} from './useRemote.js';
import {
  REMOTE_HEADING,
  REMOTE_SEND_LABEL,
  RemoteNotice,
  STOPPED_TRACKING,
  commandText,
  refusal,
} from './RemoteNotice.js';

type Waiting = {
  id: string;
  operation: 'reply' | 'remote' | 'trust' | 'action';
  startedAt: number;
};
const LIMIT = 20_000;
const COUNTER_FROM = 18_000;
const MODE_ICONS = {
  default: ShieldCheck,
  acceptEdits: Pencil,
  plan: ClipboardList,
} as const;

function isMac() {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return /mac|iphone|ipad/i.test(
    nav.userAgentData?.platform || nav.platform || '',
  );
}
function isComposing(event: KeyboardEvent | React.KeyboardEvent) {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || event.keyCode === 229;
}
function coarsePointer() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
}

export function Composer({
  projectId,
  sessionId,
  status,
  lastAt,
}: {
  projectId: string;
  sessionId: string;
  /** The session's own status, shown when c9view has no run. */
  status?: SessionStatus | undefined;
  lastAt?: string | null | undefined;
}) {
  const control = useControl();
  const machineId = useMachineId();
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [notice, setNotice] = useState('');
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
  const [, setFocusTick] = useState(0);
  const mac = isMac();
  const pollAttempt = useRef(0);
  const recovery = useRef<{ resolve: (error?: Error) => void } | undefined>(
    undefined,
  );
  const attempted = useRef({ text: '' });
  // The command a remote send is working on. A retry of the same text after a
  // lost response reuses its ID (the node replays the receipt, never resends);
  // any send after a refusal or an outcome gets a new one.
  const remoteCommand = useRef<{ id: string; text: string } | undefined>(
    undefined,
  );
  const announced = useRef(new Set<string>());
  const seenCommands = useRef(new Set<string>());
  const runs = control.ready
    ? (control.data?.runs.filter(
        (run) => run.projectId === projectId && run.sessionId === sessionId,
      ) ?? [])
    : [];
  const run = currentRun(runs, projectId, sessionId);
  const requests = control.ready
    ? (control.data?.requests.filter(
        (request) =>
          request.sessionId === sessionId &&
          runs.some((item) => item.runId === request.runId),
      ) ?? [])
    : [];
  const announcement = requests.length
    ? `${requests.length} pending ${requests.length === 1 ? 'request' : 'requests'} from Claude. ${requests.map((request) => (request.kind === 'permission' ? request.toolName : request.questions.map((question) => question.header).join(', '))).join('; ')}`
    : '';
  const activeRun = !!run && isActiveRun(run);
  const availability = useRemoteAvailability(
    control.service,
    projectId,
    sessionId,
    // Wait for the run list: one of c9view's own runs never asks.
    control.ready && control.isSuccess && !activeRun,
  );
  const remote = availability.data;
  // reply: 002's own run or a session no terminal holds. remote: a live terminal
  // session that can receive. refused: anything else, with the reason.
  const mode: 'reply' | 'remote' | 'refused' =
    activeRun ||
    !remote ||
    remote.reason === 'not-live' ||
    remote.reason === 'own-run'
      ? 'reply'
      : remote.available
        ? 'remote'
        : 'refused';
  const commands = useRemoteCommands(
    control.service,
    projectId,
    sessionId,
    control.ready,
  );
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
    // A deliberate resend after giving up is a new command.
    if (waiting?.operation === 'remote') remoteCommand.current = undefined;
    recovery.current?.resolve(new Error(unknownOutcome));
    recovery.current = undefined;
    setWaiting(undefined);
    setTrust(undefined);
    setNotice(
      waiting?.operation === 'remote'
        ? STOPPED_TRACKING
        : `This may have been sent. ${unknownOutcome}`,
    );
    focusNext(
      waiting?.operation === 'reply' || waiting?.operation === 'remote'
        ? 'composer'
        : 'card',
    );
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
  // Grow from one line up to 40% of the viewport, then scroll.
  useLayoutEffect(() => {
    const element = composer.current;
    if (!element) return;
    const cap = Math.round(window.innerHeight * 0.4);
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, cap)}px`;
  }, [text, control.ready]);
  // Announce each remote outcome once, through the composer's live region.
  // A command restored from an earlier page load is announced only when its
  // outcome changes after this page first saw it.
  useEffect(() => {
    for (const command of [...commands].reverse()) {
      const text = commandText(command);
      if (!text) continue;
      const delivery = command.receipt?.delivery;
      const key = `${command.id}:${
        command.expired
          ? 'expired'
          : delivery
            ? `${delivery.state}:${delivery.turn ?? ''}`
            : (command.receipt?.status ?? '')
      }`;
      if (announced.current.has(key)) continue;
      announced.current.add(key);
      const first = !seenCommands.current.has(command.id);
      seenCommands.current.add(command.id);
      if (!(command.restored && first)) setNotice(text);
    }
  }, [commands]);
  function refresh() {
    void control.refresh();
  }
  function outcome(value: CommandReceipt) {
    refresh();
    if (value.status === 'failed') {
      setNotice(value.error ?? 'Command failed.');
      setWaiting(undefined);
      focusNext('composer');
      return;
    }
    setWaiting(undefined);
    setText('');
    setTrust(undefined);
    setNotice('Queued');
  }
  const availabilityKey = queryKeys.remoteAvailability(
    machineId,
    projectId,
    sessionId,
  );
  // A read already in flight predates this change; drop it and read again.
  async function refreshAvailability() {
    await client.cancelQueries({ queryKey: availabilityKey });
    await client.invalidateQueries({ queryKey: availabilityKey });
  }
  // A remote command settled: show its outcome. The text goes only once the
  // message is on its way; a failed delivery keeps it for the next Send.
  function remoteOutcome(value: CommandReceipt) {
    const failed =
      value.status === 'failed' || value.delivery?.state === 'failed';
    client.setQueryData(
      queryKeys.controlReceipt(machineId, value.clientRequestId),
      value,
    );
    addRemoteCommand(
      client,
      machineId,
      projectId,
      sessionId,
      value.clientRequestId,
    );
    remoteCommand.current = undefined;
    setWaiting(undefined);
    setNotice('');
    if (!failed) setText('');
    focusNext('composer');
    if (failed) void refreshAvailability();
  }
  function failure(error: unknown, operation: Waiting['operation']) {
    refresh();
    if (error instanceof ControlError) {
      if (error.kind === 'uncertain') {
        setNotice('This may have been sent');
        beginWaiting({ id: error.clientRequestId, operation });
        return;
      }
      if (error.reason === 'unknown-outcome')
        void client.invalidateQueries({ queryKey: queryKeys.machines() });
      if (operation === 'remote') {
        // Anything but a lost response ends the command: the next Send is a new one.
        remoteCommand.current = undefined;
        if (error.reason === 'remote-unavailable') {
          if (error.availability)
            client.setQueryData(availabilityKey, error.availability);
          else void refreshAvailability();
          const reason = error.availability
            ? refusal(error.availability)
            : undefined;
          setNotice(
            reason
              ? [reason.text, reason.fix].filter(Boolean).join(' ')
              : error.message,
          );
          focusNext('composer');
          return;
        }
      }
      if (
        operation === 'reply' &&
        ['live-elsewhere', 'liveness-unknown'].includes(error.reason ?? '')
      ) {
        // No fork and no resume of a live session: ask again which way this
        // session can be reached, and keep the typed text.
        void refreshAvailability();
        setNotice(
          error.reason === 'liveness-unknown'
            ? "c9view can't tell whether another process holds this session."
            : 'This session is open in a terminal. c9view is checking how to reach it.',
        );
        focusNext('composer');
        return;
      }
      if (error.trust) {
        setTrust(error.trust);
        setChanged(error.reason === 'settings-changed');
      }
    }
    setNotice(error instanceof Error ? error.message : 'Request failed.');
    focusNext(
      operation === 'reply' || operation === 'remote' ? 'composer' : 'card',
    );
  }
  async function send(retry = false) {
    if (busy.current || actionLock.current || waiting || !control.ready) return;
    if (mode === 'refused') return;
    const draft = retry ? attempted.current.text : text;
    if (!draft.trim()) return;
    attempted.current = { text: draft };
    const remoteSend = mode === 'remote';
    const command =
      remoteCommand.current?.text === draft
        ? remoteCommand.current
        : { id: crypto.randomUUID(), text: draft };
    if (remoteSend) remoteCommand.current = command;
    busy.current = true;
    setPending(true);
    setNotice('Sending…');
    try {
      if (remoteSend)
        remoteOutcome(
          await control.service.remoteSend(
            projectId,
            sessionId,
            draft,
            command.id,
          ),
        );
      else outcome(await control.service.reply(projectId, sessionId, draft));
    } catch (error) {
      failure(error, remoteSend ? 'remote' : 'reply');
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
      await send(true);
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
        if (waiting.operation === 'remote') remoteCommand.current = undefined;
        recovery.current?.resolve(new Error(unknownOutcome));
        recovery.current = undefined;
        setNotice(
          waiting.operation === 'remote' ? STOPPED_TRACKING : unknownOutcome,
        );
        setWaiting(undefined);
        focusNext(
          waiting.operation === 'reply' || waiting.operation === 'remote'
            ? 'composer'
            : 'card',
        );
        void client.invalidateQueries({ queryKey: queryKeys.machines() });
        refresh();
      }
      return;
    }
    if (!value) return;
    if (waiting.operation === 'remote') {
      remoteOutcome(value);
      return;
    }
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
    if (waiting.operation === 'reply') outcome(value);
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
  async function action(
    task: () => Promise<CommandReceipt>,
    after?: 'composer',
  ) {
    if (actionLock.current || busy.current || waiting)
      throw new Error('Another command is pending.');
    actionLock.current = true;
    setPending(true);
    try {
      const value = await task();
      if (value.status === 'failed')
        throw new Error(value.error ?? 'Command failed.');
      refresh();
      // The control that was used is now disabled; hand focus to the reply box.
      if (after) focusNext(after);
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
  const working = !!run && ['starting', 'running'].includes(run.state);
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
      className="pointer-events-none sticky bottom-0 z-1 -mt-6 flex-none bg-linear-to-t from-page from-60% to-transparent pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      aria-label="Session control"
    >
      <div className="pointer-events-auto -m-1 max-h-[60dvh] space-y-2 overflow-y-auto p-1">
        {(run || status) && (
          <RunBar
            run={run}
            status={status}
            lastAt={lastAt}
            needsInput={requests.length > 0}
            onStopped={() => {
              // The dialog is gone and pending has cleared: restore focus.
              focusNext('composer');
              setFocusTick((n) => n + 1);
            }}
            onStop={
              run
                ? () => action(() => control.service.stop(run.runId))
                : undefined
            }
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
          <div
            key={request.requestId}
            data-control-request={request.requestId}
            className="[&>*]:rounded-2xl!"
          >
            {request.kind === 'permission' ? (
              <PermissionCard
                key={request.requestId}
                request={request}
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
          <div className="[&>*]:rounded-2xl!">
            <TrustCard
              trust={trust}
              changed={changed}
              onTrust={trustFolder}
              onCancel={() => {
                setTrust(undefined);
                setNotice('');
              }}
            />
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="space-y-1.5"
        >
          {mode === 'remote' && (
            <p id="remote-heading" className="px-2 text-xs text-muted">
              {REMOTE_HEADING}
            </p>
          )}
          <RemoteNotice
            availability={remote}
            refused={mode === 'refused'}
            commands={commands}
            needsDecision={
              mode === 'remote' &&
              (status?.column === 'need_input' ||
                remote?.sessionState === 'waiting')
            }
            slash={mode === 'remote' && text.startsWith('/')}
          />
          <div className="rounded-3xl border border-line bg-raised shadow-sm transition-shadow focus-within:border-line-strong focus-within:shadow-md focus-within:ring-2 focus-within:ring-accent/30">
            <textarea
              ref={composer}
              id="session-reply"
              aria-label="Reply to session"
              placeholder={
                mode === 'reply'
                  ? 'Reply to Claude…'
                  : 'Message the terminal session…'
              }
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, LIMIT))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || isComposing(event)) return;
                const modified =
                  (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey) &&
                  !event.shiftKey &&
                  !event.altKey;
                if (
                  !modified &&
                  (event.shiftKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey ||
                    coarsePointer())
                )
                  return;
                event.preventDefault();
                void send();
              }}
              maxLength={LIMIT}
              rows={1}
              disabled={pending || !!waiting || !!trust}
              aria-describedby={`${text.length >= COUNTER_FROM ? 'reply-count ' : ''}${mode === 'remote' ? 'remote-heading ' : ''}${mode === 'reply' ? '' : 'remote-notice '}reply-status`}
              className="block max-h-[40dvh] w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-1 text-base text-ink outline-none placeholder:text-muted disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex min-w-0 items-center gap-1">
                {control.bypass ? (
                  <BypassBadge />
                ) : (
                  <Select
                    variant="pill"
                    label="Permission mode"
                    icon={<ModeIcon mode={run?.mode} />}
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
                          control.service.mode(
                            run.runId,
                            value as PermissionMode,
                          ),
                        ).catch(() => {});
                    }}
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                {text.length >= COUNTER_FROM && (
                  <span id="reply-count" className="text-xs text-muted">
                    {text.length.toLocaleString()} / 20,000
                  </span>
                )}
                {working && !text.trim() ? (
                  <button
                    key="interrupt"
                    type="button"
                    aria-label="Stop response"
                    title="Stop response"
                    disabled={pending || !!waiting}
                    onClick={() =>
                      void action(
                        () => control.service.interrupt(run!.runId),
                        'composer',
                      ).catch(() => {})
                    }
                    className={`${roundButton} bg-ink text-page`}
                  >
                    <Square size={14} fill="currentColor" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    key="send"
                    type="submit"
                    aria-label={mode === 'reply' ? 'Send' : REMOTE_SEND_LABEL}
                    title={mode === 'reply' ? undefined : REMOTE_SEND_LABEL}
                    aria-keyshortcuts="Enter"
                    disabled={
                      !text.trim() ||
                      pending ||
                      !!waiting ||
                      !!trust ||
                      mode === 'refused'
                    }
                    className={`${roundButton} bg-accent text-page`}
                  >
                    {mode === 'reply' ? (
                      <ArrowUp size={18} aria-hidden="true" />
                    ) : (
                      <SendHorizontal size={18} aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-2 text-xs text-muted empty:hidden">
            {waiting && (
              <>
                <p role="status">Still checking whether it was sent…</p>
                <span aria-hidden="true">{elapsed}s elapsed</span>
                <Button onClick={stopWaiting}>Stop waiting</Button>
              </>
            )}
          </div>
          <p
            id="reply-status"
            role="status"
            aria-live="polite"
            className="px-2 text-xs text-muted empty:hidden"
          >
            {notice}
          </p>
        </form>
      </div>
    </div>
  );
}

const roundButton = `${targetSize} ${focusRing} inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted disabled:opacity-60 enabled:hover:opacity-90`;

function ModeIcon({ mode }: { mode: string | undefined }) {
  const Icon = MODE_ICONS[mode as keyof typeof MODE_ICONS] ?? ShieldCheck;
  return <Icon size={15} aria-hidden="true" />;
}

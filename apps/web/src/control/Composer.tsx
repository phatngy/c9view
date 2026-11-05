import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  CircleHelp,
  ClipboardList,
  Pencil,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type {
  CommandReceipt,
  PermissionMode,
  SessionStatus,
  TrustSummary,
} from '@c9view/api';
import { Button, Popover, Select, Kbd } from '../kit/index.js';
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

type Waiting = {
  id: string;
  fork: boolean;
  operation: 'reply' | 'trust' | 'action';
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
/** Clipboard API where available (secure contexts), else a hidden textarea. */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  const area = document.createElement('textarea');
  const active = document.activeElement;
  try {
    area.value = value;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.append(area);
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    if (active instanceof HTMLElement) active.focus();
  }
}
function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt>{label}</dt>
      <dd className="flex gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </dd>
    </div>
  );
}

export function Composer({
  projectId,
  sessionId,
  lastResponse,
  status,
  lastAt,
}: {
  projectId: string;
  sessionId: string;
  /** Plain text of the last assistant reply already shown on the page. */
  lastResponse?: string | undefined;
  /** The session's own status, shown when c9view has no run. */
  status?: SessionStatus | undefined;
  lastAt?: string | null | undefined;
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
  const [copyNote, setCopyNote] = useState('');
  const [, setFocusTick] = useState(0);
  const mac = isMac();
  const modKey = mac ? '⌘' : 'Ctrl';
  const lastResponseRef = useRef(lastResponse);
  lastResponseRef.current = lastResponse;
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
  // Ctrl/Cmd+Shift shortcuts work anywhere on the page, including the
  // composer. They only focus or copy; they never answer a request.
  useEffect(() => {
    if (!control.ready) return;
    let timer: number | undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isComposing(event)) return;
      const mod = mac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!mod || !event.shiftKey || event.altKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'dialog[open], [role="dialog"], [role="alertdialog"]',
        )
      )
        return;
      if (
        event.code === 'Semicolon' ||
        event.key === ';' ||
        event.key === ':'
      ) {
        event.preventDefault();
        composer.current?.focus();
      } else if (event.code === 'KeyC' || event.key.toLowerCase() === 'c') {
        // Leave the browser's copy alone when text is selected.
        // Firefox reports no window selection inside a text field.
        const field = document.activeElement;
        const fieldSelection =
          (field instanceof HTMLTextAreaElement ||
            field instanceof HTMLInputElement) &&
          field.selectionStart !== field.selectionEnd;
        if (window.getSelection()?.toString() || fieldSelection) return;
        event.preventDefault();
        const value = lastResponseRef.current;
        window.clearTimeout(timer);
        const announce = (note: string) => {
          if (!mounted.current) return;
          setCopyNote(note);
          timer = window.setTimeout(() => setCopyNote(''), 3000);
        };
        if (!value) return announce('Nothing to copy');
        copyText(value).then(
          (ok) => announce(ok ? 'Copied' : 'Could not copy'),
          () => announce('Could not copy'),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [control.ready, mac]);
  // Grow from one line up to 40% of the viewport, then scroll.
  useLayoutEffect(() => {
    const element = composer.current;
    if (!element) return;
    const cap = Math.round(window.innerHeight * 0.4);
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, cap)}px`;
  }, [text, control.ready]);
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
        <p role="status" aria-live="polite" className="sr-only">
          {copyNote}
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
          <div className="rounded-3xl border border-line bg-raised shadow-sm transition-shadow focus-within:border-line-strong focus-within:shadow-md focus-within:ring-2 focus-within:ring-accent/30">
            <textarea
              ref={composer}
              id="session-reply"
              aria-label="Reply to session"
              aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+Shift+;`}
              placeholder="Reply to Claude…"
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
              aria-describedby={`${text.length >= COUNTER_FROM ? 'reply-count ' : ''}reply-status`}
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
                <div className="hidden sm:block">
                  <Popover
                    label="Keyboard shortcuts"
                    trigger={
                      <button
                        type="button"
                        aria-label="Keyboard shortcuts"
                        className={`${targetSize} ${focusRing} inline-flex items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink`}
                      >
                        <CircleHelp size={16} aria-hidden="true" />
                      </button>
                    }
                  >
                    <h2 className="mb-2 text-sm font-semibold">
                      Keyboard shortcuts
                    </h2>
                    <dl className="space-y-2 text-sm">
                      <Shortcut label="Send" keys={['Enter']} />
                      <Shortcut label="New line" keys={['Shift', 'Enter']} />
                      <Shortcut label="Send" keys={[modKey, 'Enter']} />
                      <Shortcut
                        label="Focus the reply box"
                        keys={[modKey, 'Shift', ';']}
                      />
                      <Shortcut
                        label="Copy last response"
                        keys={[modKey, 'Shift', 'C']}
                      />
                      <Shortcut label="Search" keys={[modKey, 'K']} />
                    </dl>
                  </Popover>
                </div>
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
                    aria-label="Send"
                    aria-keyshortcuts="Enter"
                    disabled={!text.trim() || pending || !!waiting || !!trust}
                    className={`${roundButton} bg-accent text-page`}
                  >
                    <ArrowUp size={18} aria-hidden="true" />
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
            {conflict && (
              <Button
                disabled={pending || !!waiting}
                onClick={() => void send(true, true)}
              >
                Fork and reply
              </Button>
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

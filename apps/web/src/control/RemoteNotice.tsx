import { Fragment } from 'react';
import type { RemoteAvailability, RemoteDelivery } from '@c9view/api';
import { shortTime } from '../session/chat/time.js';
import type { RemoteCommand } from './useRemote.js';

export const REMOTE_SEND_LABEL = 'Send to the terminal session';
export const REMOTE_HEADING =
  'This session is open in a terminal. Your message goes into it as a message from another session.';
export const SLASH_NOTE =
  "Slash commands don't run this way; this is sent as plain text.";
export const TERMINAL_DECISION =
  'Claude is waiting for a decision. Approve in the terminal.';
export const STOPPED_TRACKING =
  'c9view stopped tracking this message. Check the conversation.';

interface Reason {
  text: string;
  fix?: string;
}
const INBOUND_FIX =
  'Let it in at the terminal, or set `crossSessionInbound` to `accept` in your user settings.';

/** What the owner reads for a session that can't receive (contract: Reasons and fixes). */
export function refusal(availability: RemoteAvailability): Reason {
  switch (availability.reason) {
    case 'liveness-unknown':
      return {
        text: "c9view can't tell whether another process holds this session.",
        fix: 'Check the terminal. Nothing is sent or resumed until c9view can tell.',
      };
    case 'too-old':
      return {
        text: `Update Claude Code to ${availability.minVersion ?? 'a newer version'} or newer.`,
        fix: 'Restart the session in the terminal after updating.',
      };
    case 'no-address':
      return {
        text: "This session can't be reached: it has no messaging address.",
        fix: 'Update Claude Code, or turn on cross-session messaging in that session.',
      };
    case 'unknown-protocol':
      return {
        text: "This session uses a messaging version c9view doesn't know.",
        fix: 'Update c9view.',
      };
    case 'not-interactive':
      return {
        text: 'This is not an interactive terminal session. Only those can receive messages.',
      };
    case 'address-invalid':
      return {
        text: "This session's messaging address can't be confirmed as its own.",
        fix: 'Restart the session in the terminal.',
      };
    case 'inbound-refused':
      return {
        text: 'This session refuses messages from other sessions.',
        fix: "Change `crossSessionInbound` in that session's settings.",
      };
    case 'token-required':
      return {
        text: "This session can't be reached: it requires a token c9view doesn't keep.",
      };
    case 'unsupported-platform':
      return {
        text: "Sending to terminal sessions isn't supported on this machine yet.",
      };
    case 'control-unavailable':
      return {
        text: 'Session control is unavailable on this machine right now.',
      };
    default:
      return { text: "c9view can't send to this session." };
  }
}

/** Advisory warning on an available session; Send stays enabled. */
export function warning(availability: RemoteAvailability): Reason | undefined {
  if (availability.inbound === 'hold')
    return {
      text: 'This session holds messages until you let them in at the terminal.',
      fix: INBOUND_FIX,
    };
  if (availability.inbound === 'may-hold')
    return {
      text: "This session may hold messages from c9view: it may be in bypass mode, or its permission mode isn't known.",
      fix: 'If nothing arrives, let it in at the terminal, or set `crossSessionInbound` to `accept` in your user settings.',
    };
  return undefined;
}

/** The exact delivery text for a receipt's `delivery` (contract: Delivery texts). */
export function deliveryText(delivery: RemoteDelivery): string {
  switch (delivery.state) {
    case 'sent':
      return 'Sent. Waiting for the session to pick it up…';
    case 'delivered':
      return delivery.turn === 'next-step'
        ? 'Delivered: Claude sees it at its next step.'
        : 'Delivered: Claude is starting a new turn.';
    case 'not-seen':
      return 'Sent, not seen yet: the session may be busy with a long step, or holding or refusing messages.';
    case 'uncertain':
      return 'This may have been sent. c9view is watching the conversation for it.';
    case 'failed':
      return delivery.reason === 'session-ended'
        ? 'Not delivered: the terminal session ended.'
        : "Not delivered: the session couldn't be reached.";
  }
}

/** Text of a tracked command: its delivery, or the expiry guidance. */
export function commandText(command: RemoteCommand): string | undefined {
  if (command.expired) return STOPPED_TRACKING;
  const delivery = command.receipt?.delivery;
  if (delivery) return deliveryText(delivery);
  if (command.receipt?.status === 'failed')
    return command.receipt.error ?? 'Not delivered.';
  return undefined;
}

/** Text with `code` spans (backticks) rendered as code, for fixes naming a setting. */
function Rich({ text }: { text: string }) {
  return text.split('`').map((part, index) =>
    index % 2 ? (
      <code key={index} className="font-mono">
        {part}
      </code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/**
 * Refusal reason and fix, advisory warning, terminal-only decision note and the
 * outcome of recent remote commands. Visible text only: outcome changes are
 * announced once by the composer's live region, so nothing here is live.
 */
export function RemoteNotice({
  availability,
  refused,
  commands,
  needsDecision,
  slash,
}: {
  availability: RemoteAvailability | undefined;
  refused: boolean;
  commands: RemoteCommand[];
  needsDecision: boolean;
  slash: boolean;
}) {
  const reason = availability && refused ? refusal(availability) : undefined;
  const warn =
    availability && !refused && availability.available
      ? warning(availability)
      : undefined;
  const shown = commands
    .map((command) => ({ command, text: commandText(command) }))
    .filter(
      (item): item is { command: RemoteCommand; text: string } =>
        item.text !== undefined &&
        // A receipt restored from this browser that expired is not news.
        !(item.command.expired && item.command.restored),
    );
  if (!reason && !warn && !needsDecision && !slash && !shown.length)
    return null;
  return (
    <div
      id="remote-notice"
      className="space-y-1 px-2 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]"
    >
      {needsDecision && <p>{TERMINAL_DECISION}</p>}
      {reason && (
        <p>
          <strong className="font-medium text-ink">
            <Rich text={reason.text} />
          </strong>
          {reason.fix && (
            <>
              {' '}
              <Rich text={reason.fix} />
            </>
          )}
        </p>
      )}
      {warn && (
        <p>
          <Rich text={warn.text} />
          {warn.fix && (
            <>
              {' '}
              <Rich text={warn.fix} />
            </>
          )}
        </p>
      )}
      {slash && <p>{SLASH_NOTE}</p>}
      {shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.map(({ command, text }) => (
            <li
              key={command.id}
              data-delivery={command.receipt?.delivery?.state}
            >
              {text}
              {command.receipt?.delivery?.state === 'delivered' &&
                command.receipt.delivery.turn === 'next-step' &&
                command.receipt.delivery.deliveredAt && (
                  <>
                    {' '}
                    <time dateTime={command.receipt.delivery.deliveredAt}>
                      {shortTime(command.receipt.delivery.deliveredAt)}
                    </time>
                  </>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

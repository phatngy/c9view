import { randomUUID } from 'node:crypto';
import { ControlError } from '../control/errors.js';

/** The frame's constant `from`: `/dev/null` is a character device, so it can never be a socket. */
export const FROM = 'uds:/dev/null/c9view';
export const FROM_NAME = 'c9view';
/** Attribution line (FR-011): states the source, claims no extra authority. */
export const ATTRIBUTION = "Sent by this session's owner from c9view.";
/** Upper bound for the whole line, far below the receiver's ~1 MiB limit. */
export const FRAME_MAX_BYTES = 131_072;
const WRAPPER_TAG = 'cross-session-message';

export interface Frame {
  msgId: string;
  /** One JSON line ending in a newline. */
  line: string;
}

/** Refuses text that could close or forge the wrapper. */
export function assertSendableText(text: string): void {
  // Also after NFKC and case folding, so look-alikes (for example U+017F) cannot slip through.
  if (
    text.toLowerCase().includes(WRAPPER_TAG) ||
    text.normalize('NFKC').toLowerCase().includes(WRAPPER_TAG)
  )
    throw new ControlError(400, 'Message text is not allowed', 'bad-text');
}

/**
 * The one frame c9view writes. No auth line and no `from-mode`: an
 * unauthenticated claim could change how a bypass-mode receiver treats it.
 */
export function buildFrame(text: string, msgId: string = randomUUID()): Frame {
  assertSendableText(text);
  const content =
    `<${WRAPPER_TAG} from="${FROM}" from-name="${FROM_NAME}">\n` +
    `${ATTRIBUTION}\n\n${text}\n</${WRAPPER_TAG}>`;
  const line =
    JSON.stringify({
      msgV: 1,
      msg_id: msgId,
      type: 'user',
      message: { role: 'user', content },
      priority: 'next',
      from: FROM,
    }) + '\n';
  if (Buffer.byteLength(line, 'utf8') > FRAME_MAX_BYTES)
    throw new ControlError(413, 'Message too large');
  return { msgId, line };
}

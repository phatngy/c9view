import type { SessionLabels } from '@c9view/api';
import { ControlError } from '../control/errors.js';
import type { LabelStore } from '../control/state.js';

// Labels are one line of at most 80 characters, without control characters.
// Control, line and paragraph separator and format characters (bidi controls,
// U+200B, U+FEFF, U+2060 and the rest of Cf) are refused. ZWJ and ZWNJ
// (U+200D, U+200C) and the tag characters U+E0020-U+E007F (flag emoji) are Cf
// but allowed; variation selectors (Mn) are not refused, so emoji labels work.
const forbidden =
  // eslint-disable-next-line no-misleading-character-class -- ZWJ, ZWNJ and tags are listed on purpose.
  /[\p{Cc}\p{Zl}\p{Zp}]|(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/u;
// A non-empty label needs a visible character: not only whitespace, joiners,
// variation selectors, tags or invisible filler characters.
const invisibleOnly =
  // eslint-disable-next-line no-misleading-character-class -- invisible code points are listed on purpose.
  /^[\s\u200C\u200D\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u{E0020}-\u{E007F}\u034F\u115F\u1160\u3164\uFFA0]*$/u;

export function normalizeLabel(value: string): string {
  const label = value.trim();
  if (
    label.length > 80 ||
    forbidden.test(label) ||
    (label !== '' && invisibleOnly.test(label))
  )
    throw new ControlError(400, 'Invalid label');
  return label;
}

/** c9view-only labels, kept in the node state store, never in Claude data or the index. */
export function createLabels(
  state: LabelStore,
  sessionExists: (projectId: string, sessionId: string) => Promise<boolean>,
) {
  return {
    async set(projectId: string, sessionId: string, value: string) {
      const label = normalizeLabel(value);
      if (!(await sessionExists(projectId, sessionId)))
        throw new ControlError(404, 'Session not found');
      state.setLabel(projectId, sessionId, label);
    },
    all: (): SessionLabels => ({ labels: state.labels() }),
  };
}

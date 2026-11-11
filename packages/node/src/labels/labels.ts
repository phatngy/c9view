import type { SessionLabels } from '@c9view/api';
import { ControlError } from '../control/errors.js';
import type { LabelStore } from '../control/state.js';

// Labels are one line of at most 80 characters, without control characters.
// eslint-disable-next-line no-control-regex
const forbidden = /[\x00-\x1f\x7f]/;

export function normalizeLabel(value: string): string {
  const label = value.trim();
  if (label.length > 80 || forbidden.test(label))
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

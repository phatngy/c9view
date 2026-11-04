import { redactText } from '@c9view/core';
import type { TrustSummary } from '@c9view/api';
export class ControlError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 429 | 503,
    message: string,
    readonly reason?: string,
    readonly trust?: TrustSummary,
  ) {
    super(redactText(message));
    this.name = 'ControlError';
  }
}

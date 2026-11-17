import type { RemoteAvailability } from '@c9view/api';
import { ControlError } from '../control/errors.js';

/** 409 `remote-unavailable`: the fresh check refused the send; nothing was written. */
export class RemoteUnavailableError extends ControlError {
  constructor(readonly availability: RemoteAvailability) {
    super(
      409,
      'Remote send is not available for this session',
      'remote-unavailable',
    );
  }
}

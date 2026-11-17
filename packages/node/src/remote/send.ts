import { createConnection, type Socket } from 'node:net';

export type SendOutcome =
  | { state: 'sent' }
  | { state: 'uncertain' }
  | { state: 'error'; code: string; wrote: boolean };

export type Delivered =
  | { state: 'sent' }
  | { state: 'uncertain' }
  | { state: 'failed'; reason: 'session-ended' | 'unreachable' };

export interface SendOptions {
  timeoutMs: number;
  /** Test seam: the default opens a Unix socket at the path. */
  connect?: (path: string) => Socket;
}

/**
 * One connect, one write, one end. Never reads a reply, never retries, never
 * signals or changes the peer. `sent` means the whole frame was flushed and
 * the connection ended cleanly; a timeout is `uncertain` (part of a frame can
 * still be delivered), and the frame is never written again. The address is
 * used here only and not kept.
 */
export function sendFrame(
  path: string,
  line: string,
  options: SendOptions,
): Promise<SendOutcome> {
  return new Promise((resolve) => {
    const socket = (options.connect ?? ((p) => createConnection({ path: p })))(
      path,
    );
    let settled = false;
    let connected = false;
    // Before connect nothing was written: a plain failure. After it, the
    // frame may be partly delivered: uncertain, and never resent.
    const timer = setTimeout(
      () =>
        done(
          connected
            ? { state: 'uncertain' }
            : { state: 'error', code: 'ETIMEDOUT', wrote: false },
        ),
      options.timeoutMs,
    );
    const wrote = () => socket.bytesWritten > 0;
    function done(outcome: SendOutcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    }
    socket.on('error', (error: NodeJS.ErrnoException) =>
      done({
        state: 'error',
        code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
        wrote: wrote(),
      }),
    );
    // Closed before the write finished: no code, so it is a broken connection.
    socket.on('close', () =>
      done({ state: 'error', code: 'ECONNRESET', wrote: wrote() }),
    );
    socket.on('finish', () => done({ state: 'sent' }));
    socket.once('connect', () => {
      connected = true;
      socket.end(line);
    });
  });
}

/**
 * R7 error mapping. `gone` is evaluated only for the connect-class errors,
 * after the error, and means the PID is dead or its `procStart` changed.
 */
export function mapSend(outcome: SendOutcome, gone: () => boolean): Delivered {
  if (outcome.state !== 'error') return outcome;
  const before = (): Delivered => ({
    state: 'failed',
    reason: gone() ? 'session-ended' : 'unreachable',
  });
  switch (outcome.code) {
    case 'ENOENT':
    case 'ECONNREFUSED':
      return before();
    case 'ENOTSOCK':
    case 'EACCES':
      return { state: 'failed', reason: 'unreachable' };
    case 'EPIPE':
    case 'ECONNRESET':
      return outcome.wrote ? { state: 'uncertain' } : before();
    default:
      return outcome.wrote
        ? { state: 'uncertain' }
        : { state: 'failed', reason: 'unreachable' };
  }
}

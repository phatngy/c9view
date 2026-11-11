import { z } from 'zod';
import { ControlError } from './errors.js';

/** Boot identity check, bounded body read and JSON parse shared by every control POST. */
export async function readCommand(
  request: Request,
  bodyMaxBytes: number,
  bootHeader: string | undefined,
): Promise<{ boot: string; value: unknown }> {
  const boot = bootHeader;
  if (!boot || !z.uuid().safeParse(boot).success)
    throw new ControlError(403, 'Missing or invalid boot identity');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > bodyMaxBytes) {
          await reader.cancel();
          throw new ControlError(413, 'Request body too large');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ControlError(400, 'Invalid JSON body');
  }
  if (
    value &&
    typeof value === 'object' &&
    (('permissionMode' in value &&
      value.permissionMode === 'bypassPermissions') ||
      ('mode' in value && value.mode === 'bypassPermissions'))
  )
    throw new ControlError(
      400,
      'Browser cannot request bypass',
      'bypass-not-allowed',
    );
  return { boot, value };
}

/** Maps a ControlError to the JSON error body every control route returns. */
export function controlErrorResponse(
  error: unknown,
  json: (body: object, status: ControlError['status'] | 500) => Response,
): Response {
  return error instanceof ControlError
    ? json(
        {
          error: error.message,
          ...(error.reason ? { reason: error.reason } : {}),
          ...(error.trust ? { trust: error.trust } : {}),
        },
        error.status,
      )
    : json({ error: 'Control operation failed' }, 500);
}

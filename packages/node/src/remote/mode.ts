import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { permissionModeRecordSchema } from '@c9view/core';

export const MODE_TAIL_BYTES = 64 * 1024;

/**
 * The receiver's permission mode from the last 64 KiB of its transcript: the
 * last `permission-mode` record, else the last `permissionMode` string on any
 * record. Unknown (undefined) when none is found or the file is unreadable.
 * Node-only; the result is never stored, logged or returned.
 */
export async function readReceiverMode(
  path: string,
  tailBytes: number = MODE_TAIL_BYTES,
): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const { size, isFile } = await handle.stat().then((s) => ({
      size: s.size,
      isFile: s.isFile(),
    }));
    if (!isFile) return undefined;
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        read,
        buffer.length - read,
        start + read,
      );
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    let text = buffer.subarray(0, read).toString('utf8');
    // The first line of a mid-file window may be cut; never trust it.
    if (start > 0) {
      const newline = text.indexOf('\n');
      text = newline < 0 ? '' : text.slice(newline + 1);
    }
    let record: string | undefined;
    let any: string | undefined;
    for (const line of text.split('\n')) {
      if (!line.includes('permission')) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = permissionModeRecordSchema.safeParse(value);
      if (parsed.success) record = parsed.data.permissionMode;
      else if (
        value &&
        typeof value === 'object' &&
        'permissionMode' in value &&
        typeof value.permissionMode === 'string'
      )
        any = value.permissionMode;
    }
    return record ?? any;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

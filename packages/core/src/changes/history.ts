import { createFileAccess } from '../files/index.js';
import type { TranscriptRecord } from '../transcript/index.js';
import { CONTENT_LIMIT, obj, str } from './tools.js';
import type { FileHistoryVersion } from './types.js';
import { join } from 'node:path';

export async function readFileHistory(
  claudeDir: string,
  sessionId: string,
  records: readonly TranscriptRecord[],
): Promise<Map<string, FileHistoryVersion[]>> {
  if (!/^[\w-]+$/.test(sessionId)) throw new Error('Unsafe session id');
  const history = new Map<string, FileHistoryVersion[]>();
  function add(path: string, value: unknown, messageId: string) {
    const b = obj(value);
    if (
      !path ||
      !Number.isInteger(b.version) ||
      typeof b.backupTime !== 'string' ||
      !(
        b.backupFileName === null ||
        (typeof b.backupFileName === 'string' &&
          /^[\w.@-]+$/.test(b.backupFileName))
      )
    )
      return;
    const versions = history.get(path) ?? [];
    if (
      !versions.some(
        (v) => v.version === b.version && v.backupFileName === b.backupFileName,
      )
    )
      versions.push({
        version: b.version as number,
        backupFileName: b.backupFileName as string | null,
        messageId,
        backupTime: b.backupTime,
      });
    history.set(path, versions);
  }
  for (const r of records) {
    if (r.type === 'file-history-snapshot') {
      const snapshot = obj(r.snapshot);
      for (const [path, backup] of Object.entries(
        obj(snapshot.trackedFileBackups),
      ))
        add(path, backup, str(snapshot.messageId ?? r.messageId));
    } else if (r.type === 'file-history-delta')
      add(
        str(r.trackingPath),
        r.backup,
        str(r.messageId ?? r.snapshotMessageId),
      );
  }
  for (const versions of history.values())
    versions.sort(
      (a, b) =>
        a.version - b.version || a.backupTime.localeCompare(b.backupTime),
    );
  return history;
}
// Real data confirms backups contain the pre-change content at a user-message
// checkpoint, not the result of the associated tool. Repeated snapshot entries
// reference the same backup; null backupFileName denotes a previously absent file.
// Therefore the final backup must have subsequent tool patches applied to it.
export async function readBackup(
  claudeDir: string,
  sessionId: string,
  version: FileHistoryVersion,
) {
  if (version.backupFileName === null) return { content: '', tooLarge: false };
  try {
    return await createFileAccess({
      root: join(claudeDir, 'file-history', sessionId),
    }).readFile(version.backupFileName, { maxBytes: CONTENT_LIMIT });
  } catch {
    return undefined;
  }
}

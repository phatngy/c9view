import { isUserRecord, type TranscriptRecord } from './schemas.js';
import { originSchema, queuedCommandAttachmentSchema } from './schemas.js';

export const C9VIEW_FROM = 'uds:/dev/null/c9view';
export const C9VIEW_NAME = 'c9view';
export const ATTRIBUTION_LINE = "Sent by this session's owner from c9view.";

export interface PeerMessage {
  /** True only for the exact c9view `origin.from` and `origin.name` pair. */
  fromC9view: boolean;
  /** Display text, or null to show the record's own content. */
  text: string | null;
  verifiedPeerPid?: number;
  verifiedPeerProcStart?: string;
}

/** Drop the exact attribution line (first line only) and the blank line after it. */
function withoutAttribution(body: string): string {
  const lines = body.split('\n');
  if (lines[0] !== ATTRIBUTION_LINE) return body;
  lines.splice(0, lines[1] === '' ? 2 : 1);
  return lines.join('\n');
}

/** Read the peer origin of an idle `user` or mid-turn `queued_command` record. */
export function readPeerMessage(record: TranscriptRecord): PeerMessage | null {
  let origin;
  let prompt: string | undefined;
  if (record.type === 'user') {
    if (!isUserRecord(record)) return null;
    origin = originSchema.safeParse(record.origin).data;
  } else if (record.type === 'attachment') {
    const parsed = queuedCommandAttachmentSchema.safeParse(
      (record as { attachment?: unknown }).attachment,
    );
    if (!parsed.success) return null;
    origin = parsed.data.origin;
    prompt = parsed.data.prompt;
  } else return null;
  if (origin?.kind !== 'peer') return null;
  const fromC9view = origin.from === C9VIEW_FROM && origin.name === C9VIEW_NAME;
  const message: PeerMessage = {
    fromC9view,
    text:
      fromC9view && origin.body !== undefined
        ? withoutAttribution(origin.body)
        : (prompt ?? null),
  };
  if (origin.verifiedPeerPid !== undefined)
    message.verifiedPeerPid = origin.verifiedPeerPid;
  if (origin.verifiedPeerProcStart !== undefined)
    message.verifiedPeerProcStart = origin.verifiedPeerProcStart;
  return message;
}

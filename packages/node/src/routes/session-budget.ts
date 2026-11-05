import type { Message, MessageBlock } from '@c9view/api';
import { encodedBytes, fitText, TRUNCATED_MARKER } from '../budget.js';

const marker: MessageBlock = { type: 'text', text: TRUNCATED_MARKER };
// Below this much room a partial text block is not worth sending.
const MIN_TEXT_BYTES = 256;

/**
 * Cuts one message that is larger than a whole page: whole blocks first, then
 * as much of the next text block as fits, then a marker. Never cuts JSON.
 */
export function shrinkMessage(message: Message, roomBytes: number): Message {
  const shell: Message = { ...message, blocks: [], truncated: true };
  let used = encodedBytes(shell);
  const blocks: MessageBlock[] = [];
  const markerBytes = encodedBytes(marker) + 1;
  let cutInside = false;
  for (const block of message.blocks) {
    const size = encodedBytes(block) + (blocks.length ? 1 : 0);
    if (used + size + markerBytes <= roomBytes) {
      blocks.push(block);
      used += size;
      continue;
    }
    if ('text' in block) {
      const empty = encodedBytes({ ...block, text: '' }) + 1;
      const room = roomBytes - used - empty;
      if (room >= MIN_TEXT_BYTES) {
        blocks.push({ ...block, text: fitText(block.text, room) });
        cutInside = true;
      }
    }
    break;
  }
  if (!cutInside) blocks.push(marker);
  return { ...shell, blocks };
}

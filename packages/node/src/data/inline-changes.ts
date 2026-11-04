import { extractToolChanges, type TranscriptRecord } from '@c9view/core';
import type { InlineChange } from '@c9view/api';

// TranscriptCache replaces the records array when path/size/mtime changes and
// releases it on LRU eviction. Use that identity to share the core extraction
// with sessionChanges without retaining a second transcript copy.
const cache = new WeakMap<TranscriptRecord[], Map<string, InlineChange>>();
export function inlineChanges(
  records: TranscriptRecord[],
): Map<string, InlineChange> {
  const previous = cache.get(records);
  if (previous) return previous;
  const value = new Map(
    extractToolChanges(records, { maxPerFile: 2000, maxSession: 5000 }).map(
      (change) => {
        let remaining = 2000;
        let truncated = change.tooLarge === true;
        const hunks = [];
        for (const h of change.hunks) {
          const lines = h.lines.slice(0, remaining);
          remaining -= lines.length;
          truncated ||= lines.length < h.lines.length;
          if (lines.length) hunks.push({ ...h, lines });
        }
        return [
          change.toolUseId,
          {
            filePath: change.filePath,
            kind: change.kind,
            additions: change.additions,
            deletions: change.deletions,
            hunks,
            truncated,
          },
        ];
      },
    ),
  );
  cache.set(records, value);
  return value;
}

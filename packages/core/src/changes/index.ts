import { createHash } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import type { TranscriptRecord } from '../transcript/index.js';
import { redactText } from '../redact/index.js';
import { inside } from '../files/policy.js';
import { readBackup, readFileHistory } from './history.js';
import {
  applyHunks,
  CONTENT_LIMIT,
  counts,
  detailedChanges,
  makeHunks,
  safeChange,
} from './tools.js';
import type {
  ChangeHunk,
  SessionChangedFile,
  SessionFileDiff,
} from './types.js';
export * from './types.js';
export { extractToolChanges } from './tools.js';
export { readFileHistory } from './history.js';

export async function sessionChanges({
  claudeDir,
  sessionId,
  records,
  root,
}: {
  claudeDir: string;
  sessionId: string;
  records: readonly TranscriptRecord[];
  root: string;
}) {
  const recordPositions = new Map(
    records.map((r, i) => [
      typeof r.uuid === 'string' ? r.uuid : `record-${i}`,
      i,
    ]),
  );
  const detailed = detailedChanges(records, root);
  const history = await readFileHistory(claudeDir, sessionId, records);
  const grouped = new Map<string, typeof detailed>();
  for (const d of detailed) {
    const group = grouped.get(d.change.filePath) ?? [];
    group.push(d);
    grouped.set(d.change.filePath, group);
  }
  const files: SessionChangedFile[] = [];
  const diffs = new Map<string, Promise<SessionFileDiff>>();
  const loaders = new Map<string, () => Promise<SessionFileDiff>>();
  let totalSteps = 0;
  let truncated = false;
  for (const [filePath, steps] of grouped) {
    const first = steps[0]!,
      last = steps.at(-1)!;
    const fileId = createHash('sha256')
      .update(filePath)
      .digest('hex')
      .slice(0, 24);
    const versions = history.get(filePath) ?? [];
    const retained = steps.slice(
      0,
      Math.min(2000, Math.max(0, 5000 - totalSteps)),
    );
    totalSteps += retained.length;
    const capped = retained.length < steps.length;
    truncated ||= capped;
    const summary = retained.reduce(
      (sum, step) => ({
        additions: sum.additions + step.change.additions,
        deletions: sum.deletions + step.change.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
    loaders.set(fileId, async () => {
      let before = first.before;
      let source: SessionFileDiff['source'] = 'tool-hunks';
      let tooLarge = steps.some((s) => s.change.tooLarge);
      const backup = versions[0]
        ? await readBackup(claudeDir, sessionId, versions[0])
        : undefined;
      if (backup?.content !== undefined) {
        before = backup.content;
        source = 'file-history';
      }
      tooLarge ||= backup?.tooLarge === true;
      let after = before;
      let applySteps = steps;
      const latestVersion = versions.at(-1);
      if (latestVersion && versions.length > 1) {
        const checkpoint = recordPositions.get(latestVersion.messageId) ?? -1;
        const latest = await readBackup(claudeDir, sessionId, latestVersion);
        tooLarge ||= latest?.tooLarge === true;
        if (checkpoint >= 0 && latest?.content !== undefined) {
          after = latest.content;
          applySteps = steps.filter(
            (s) =>
              (recordPositions.get(s.change.messageUuid) ?? -1) > checkpoint,
          );
        }
      }
      let partial = before === undefined;
      const finalAfter = tooLarge ? undefined : last.after;
      if (finalAfter !== undefined) after = finalAfter;
      else if (after !== undefined && !tooLarge)
        for (const step of applySteps) {
          if (step.after !== undefined) after = step.after;
          else if (step.before !== undefined)
            after = applyHunks(step.before, step.change.hunks);
          else
            after =
              after === undefined
                ? undefined
                : applyHunks(after, step.change.hunks);
          if (after === undefined) {
            partial = true;
            break;
          }
        }
      // With no full-file source, compose line identities through every patch.
      // Unknown context is retained as blank placeholders and explicitly marked partial.
      let hunks: ChangeHunk[] = [];
      if (before !== undefined && after !== undefined) {
        tooLarge ||=
          Buffer.byteLength(before) > CONTENT_LIMIT ||
          Buffer.byteLength(after) > CONTENT_LIMIT;
        if (!tooLarge) hunks = makeHunks(before, after);
      } else if (!tooLarge) {
        const original: string[] = [];
        const current: { text: string; origin: number | null }[] = [];
        for (const step of steps) {
          let offset = 0;
          for (const h of step.change.hunks) {
            const at = Math.max(0, h.oldStart - 1 + offset);
            const old = h.lines
              .filter((l) => l[0] === ' ' || l[0] === '-')
              .map((l) => l.slice(1));
            if (at + old.length > CONTENT_LIMIT / 2) {
              tooLarge = true;
              break;
            }
            while (current.length < at + old.length) {
              const id = original.length;
              original.push('');
              current.push({ text: '', origin: id });
            }
            old.forEach((text, i) => {
              const line = current[at + i]!;
              line.text = text;
              if (line.origin !== null) original[line.origin] = text;
            });
            let cursor = 0;
            const replacement: typeof current = [];
            for (const line of h.lines) {
              if (line[0] === ' ') replacement.push(current[at + cursor++]!);
              else if (line[0] === '-') cursor++;
              else if (line[0] === '+')
                replacement.push({ text: line.slice(1), origin: null });
            }
            current.splice(at, old.length, ...replacement);
            offset += h.newLines - h.oldLines;
          }
        }
        const originalText =
          original.join('\n') + (original.length ? '\n' : '');
        const currentText =
          current.map((l) => l.text).join('\n') + (current.length ? '\n' : '');
        tooLarge ||=
          Buffer.byteLength(originalText) > CONTENT_LIMIT ||
          Buffer.byteLength(currentText) > CONTENT_LIMIT;
        hunks = tooLarge ? [] : makeHunks(originalText, currentText);
      }
      const totals = counts(hunks);
      const diff: SessionFileDiff = {
        fileId,
        filePath: redactText(filePath),
        hunks: safeChange({ ...first.change, hunks }).hunks,
        ...totals,
        source,
        steps: retained.map((s) => safeChange(s.change)),
        tooLarge,
        partial,
        truncated: capped,
      };
      return diff;
    });
    files.push({
      fileId,
      filePath: redactText(filePath),
      relPath:
        isAbsolute(filePath) && inside(root, filePath)
          ? redactText(relative(root, filePath))
          : redactText(filePath),
      kind: first.change.kind,
      ...summary,
      toolUseIds: retained.map((s) => s.change.toolUseId),
      firstAt: first.change.timestamp,
      lastAt: last.change.timestamp,
    });
  }
  return {
    files,
    truncated,
    sessionFileDiff: (fileId: string) => {
      const loader = loaders.get(fileId);
      if (!loader) return undefined;
      let value = diffs.get(fileId);
      if (!value) {
        value = loader();
        diffs.set(fileId, value);
      }
      return value;
    },
  };
}

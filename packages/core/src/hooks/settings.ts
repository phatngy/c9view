import {
  readFile,
  writeFile,
  stat,
  rename,
  unlink,
  mkdir,
  chmod,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HOOK_EVENTS } from './events.js';

const object = z.record(z.string(), z.unknown());
export const HOOK_MARKER = '--c9view-hook';
function marked(value: unknown): boolean {
  const parsed = object.safeParse(value);
  return (
    parsed.success &&
    typeof parsed.data.command === 'string' &&
    /(?:^|\s)--c9view-hook(?:\s|$)/.test(parsed.data.command)
  );
}
export function updateHookSettings(
  settings: Record<string, unknown>,
  command: string,
  install: boolean,
): Record<string, unknown> {
  // Remove older marked commands first so installs upgrade the entry and async flag.
  if (install) {
    const clean = updateHookSettings(settings, command, false);
    return addHookSettings(clean, command);
  }
  const result = structuredClone(settings);
  const hooks = result.hooks === undefined ? {} : object.parse(result.hooks);
  let createdHooks = false;
  for (const event of HOOK_EVENTS) {
    const groups =
      hooks[event] === undefined ? [] : z.array(object).parse(hooks[event]);
    const ours = groups.flatMap((group) =>
      Array.isArray(group.hooks) ? group.hooks.filter(marked) : [],
    );
    const createdEvent = ours.some((hook) =>
      String(hook.command).includes(' --c9view-created-event'),
    );
    createdHooks ||= ours.some((hook) =>
      String(hook.command).includes(' --c9view-created-hooks'),
    );
    const kept = groups.flatMap((group) => {
      if (!Array.isArray(group.hooks) || !group.hooks.some(marked))
        return [group];
      const remaining = group.hooks.filter((hook) => !marked(hook));
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    if (kept.length) hooks[event] = kept;
    else if (groups.length) {
      if (createdEvent) delete hooks[event];
      else hooks[event] = [];
    }
  }
  if (
    Object.keys(hooks).length ||
    (settings.hooks !== undefined && !createdHooks)
  )
    result.hooks = hooks;
  else delete result.hooks;
  return result;
}
function addHookSettings(
  settings: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const result = structuredClone(settings);
  const hooks = result.hooks === undefined ? {} : object.parse(result.hooks);
  for (const event of HOOK_EVENTS) {
    const groups =
      hooks[event] === undefined ? [] : z.array(object).parse(hooks[event]);

    if (
      !groups.some(
        (group) => Array.isArray(group.hooks) && group.hooks.some(marked),
      )
    ) {
      groups.push({
        ...(![
          'UserPromptSubmit',
          'Stop',
          'StopFailure',
          'PostToolBatch',
        ].includes(event)
          ? { matcher: '*' }
          : {}),
        hooks: [
          {
            type: 'command',
            command:
              command +
              (settings.hooks === undefined ? ' --c9view-created-hooks' : '') +
              (hooks[event] === undefined ? ' --c9view-created-event' : ''),
            timeout: 5,
            async: true,
          },
        ],
      });
      hooks[event] = groups;
    }
  }
  result.hooks = hooks;
  return result;
}
export async function hooksInstalled(claudeDir: string): Promise<boolean> {
  try {
    const settings = object.parse(
      JSON.parse(await readFile(join(claudeDir, 'settings.json'), 'utf8')),
    );
    const hooks = object.parse(settings.hooks);
    return HOOK_EVENTS.every(
      (event) =>
        Array.isArray(hooks[event]) &&
        hooks[event].some((group) => {
          const parsed = object.safeParse(group);
          return (
            parsed.success &&
            Array.isArray(parsed.data.hooks) &&
            parsed.data.hooks.some(marked)
          );
        }),
    );
  } catch {
    return false;
  }
}
export function hookCommand(execPath: string, entryPath: string): string {
  // POSIX shell quoting protects spaces, quotes, substitutions and backticks.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return `${quote(execPath)} ${quote(entryPath)} ${HOOK_MARKER}`;
}
export async function planHookSettings(
  claudeDir: string,
  command: string,
  install: boolean,
) {
  const path = join(claudeDir, 'settings.json');
  let existed = false;
  let before = '';
  let mode = 0o600;
  try {
    before = await readFile(path, 'utf8');
    existed = true;
    mode = (await stat(path)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const settings = before ? object.parse(JSON.parse(before)) : {};
  const updated = updateHookSettings(settings, command, install);
  const after =
    JSON.stringify(settings) === JSON.stringify(updated)
      ? before
      : JSON.stringify(updated, null, 2) + '\n';
  const diff = lineDiff(before, after);
  return { path, before, after, mode, diff, existed };
}
export async function writeHookSettings(
  plan: Awaited<ReturnType<typeof planHookSettings>>,
): Promise<void> {
  if (!plan.diff) return;
  let current = '';
  try {
    current = await readFile(plan.path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (current !== plan.before)
    throw new Error('Settings changed since preview; run the command again');
  const suffix =
    new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
  await mkdir(dirname(plan.path), { recursive: true, mode: 0o700 });
  if (plan.existed)
    await writeFile(`${plan.path}.c9view-backup-${suffix}`, plan.before, {
      flag: 'wx',
      mode: plan.mode,
    });
  const temp = `${plan.path}.c9view-${suffix}.tmp`;
  try {
    await writeFile(temp, plan.after, { flag: 'wx', mode: plan.mode });
    await chmod(temp, plan.mode);
    await rename(temp, plan.path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

/** Small settings files: LCS edits grouped into unified hunks with three context lines. */
export function lineDiff(before: string, after: string): string {
  if (before === after) return '';
  const lines = (text: string) =>
    text ? text.replace(/\n$/, '').split('\n') : [];
  const a = lines(before),
    b = lines(after);
  const lengths = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  }
  const edits: { prefix: string; text: string; old: number; next: number }[] =
    [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    const old = i + 1,
      next = j + 1;
    if (i < a.length && j < b.length && a[i] === b[j]) {
      edits.push({ prefix: ' ', text: a[i++]!, old, next });
      j++;
    } else if (
      i < a.length &&
      (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)
    )
      edits.push({ prefix: '-', text: a[i++]!, old, next });
    else edits.push({ prefix: '+', text: b[j++]!, old, next });
  }
  const ranges: { start: number; end: number }[] = [];
  for (let k = 0; k < edits.length; k++) {
    if (edits[k]!.prefix === ' ') continue;
    const start = Math.max(0, k - 3),
      end = Math.min(edits.length, k + 4);
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  }
  return (
    '--- settings.json\n+++ settings.json\n' +
    ranges
      .map(({ start, end }) => {
        const hunk = edits.slice(start, end);
        const oldCount = hunk.filter((e) => e.prefix !== '+').length;
        const newCount = hunk.filter((e) => e.prefix !== '-').length;
        return (
          `@@ -${hunk[0]!.old - (oldCount ? 0 : 1)},${oldCount} +${hunk[0]!.next - (newCount ? 0 : 1)},${newCount} @@\n` +
          hunk.map((e) => e.prefix + e.text).join('\n') +
          '\n'
        );
      })
      .join('')
  );
}

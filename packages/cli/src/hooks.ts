import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import {
  hookStateDir,
  defaultStateDir,
  HookEventTailer,
  hooksInstalled,
  hookCommand,
  planHookSettings,
  writeHookSettings,
} from '@c9view/core';
export async function runHooksCommand(
  action: string | undefined,
  claudeDir: string,
  yes: boolean,
): Promise<void> {
  if (action === 'status') {
    const tailer = new HookEventTailer();
    await tailer.refresh();
    const path = join(hookStateDir(), 'events.jsonl');
    const size = await stat(path)
      .then((s) => s.size)
      .catch(() => 0);
    const eventsLastHour = tailer.eventsLastHour();
    console.log(
      JSON.stringify({
        installed: await hooksInstalled(claudeDir),
        eventsFile: path,
        legacyEventsFile: tailer.legacyEventsFile,
        legacySize: tailer.legacyEventsFile
          ? await stat(tailer.legacyEventsFile)
              .then((s) => s.size)
              .catch(() => 0)
          : 0,
        size,
        lastEventAt: tailer.lastEventAt,
        eventsLastHour,
      }),
    );
    return;
  }
  if (action !== 'install' && action !== 'uninstall')
    throw new Error(
      'Usage: c9view hooks install|uninstall|status [--yes] [--claude-dir path]',
    );
  const plan = await planHookSettings(
    claudeDir,
    hookCommand(
      process.execPath,
      fileURLToPath(
        new URL(
          '../dist/hooks/hook-entry.js',
          import.meta.resolve('@c9view/core'),
        ),
      ),
      hookStateDir() === defaultStateDir() ? undefined : hookStateDir(),
    ),
    action === 'install',
  );
  if (!plan.diff) {
    console.log(
      'Hooks already ' + (action === 'install' ? 'installed' : 'uninstalled'),
    );
    return;
  }
  console.log(plan.diff);
  if (!yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error('Refusing without a TTY; pass --yes to apply this diff');
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      if (
        !/^y(es)?$/i.test(
          (await prompt.question('Apply these changes? [y/N] ')).trim(),
        )
      )
        return;
    } finally {
      prompt.close();
    }
  }
  await writeHookSettings(plan);
  console.log('Hooks ' + (action === 'install' ? 'installed' : 'uninstalled'));
}

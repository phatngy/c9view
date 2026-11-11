#!/usr/bin/env node
if (
  process.argv[2] === 'hook' &&
  !process.argv.includes('--help') &&
  !process.argv.includes('-h')
) {
  try {
    // Import the small built hook module directly: the core barrel loads SQLite.
    const moduleUrl = new URL(
      '../dist/hooks/hook-entry.js',
      import.meta.resolve('@c9view/core'),
    );
    const { runHook } = (await import(moduleUrl.href)) as {
      runHook: () => Promise<void>;
    };
    await runHook();
  } catch {
    /* Hooks must remain silent and must never block Claude. */
  }
  process.exit(0);
}
try {
  const { parseArgs } = await import('node:util');
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      port: { type: 'string' },
      host: { type: 'string' },
      open: { type: 'boolean' },
      control: { type: 'boolean' },
      bypass: { type: 'boolean' },
      auth: { type: 'string' },
      'allowed-host': { type: 'string', multiple: true },
      'workspace-root': { type: 'string', multiple: true },
      json: { type: 'boolean' },
      yes: { type: 'boolean' },
      db: { type: 'string' },
      'claude-dir': { type: 'string' },
    },
  });
  if (values.help) {
    console.log(`Usage:
  c9view [start] [--port 7777] [--host 127.0.0.1] [--auth none|token|password]
    [--allowed-host hostname] [--workspace-root path] [--control] [--bypass] [--open] [--db path] [--claude-dir path]
  c9view scan [--json] [--db path] [--claude-dir path]
  c9view hooks install|uninstall [--yes] [--claude-dir path]
  c9view hooks status [--claude-dir path]
  c9view hook (silent Claude hook receiver)
  --help, -h  Show usage for all commands`);
  } else if (
    positionals.length === 0 ||
    (positionals.length === 1 && positionals[0] === 'start')
  ) {
    const { runStart } = await import('./start.js');
    await runStart(values);
  } else {
    const { loadConfig, scan } = await import('@c9view/core');
    if (
      positionals[0] !== 'hooks' &&
      (positionals.length !== 1 || positionals[0] !== 'scan')
    )
      throw new Error(
        'Usage: c9view [start] [--port 7777] [--host 127.0.0.1] [--auth none|token|password] [--allowed-host host] [--open] [--db path] [--claude-dir path], or c9view scan / hooks',
      );
    const config = loadConfig({
      ...process.env,
      ...(values.db ? { C9VIEW_DB: values.db } : {}),
      ...(values['claude-dir']
        ? { C9VIEW_CLAUDE_DIR: values['claude-dir'] }
        : {}),
    });
    if (positionals[0] === 'hooks') {
      const { runHooksCommand } = await import('./hooks.js');
      await runHooksCommand(
        positionals[1],
        config.claudeDir,
        values.yes ?? false,
      );
    } else {
      const summary = await scan(config);
      console.log(
        values.json
          ? JSON.stringify(summary)
          : Object.entries(summary)
              .map(
                ([key, value]) =>
                  `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`,
              )
              .join('\n'),
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Scan failed');
  process.exitCode = 1;
}

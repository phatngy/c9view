import { execFileSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, delimiter, join, resolve } from 'node:path';
import { z } from 'zod';

export class ControlConfigError extends Error {
  override name = 'ControlConfigError';
}
export interface ControlOverrides {
  control?: boolean;
  bypass?: boolean;
}
export function loadControlConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ControlOverrides = {},
) {
  function parse<T>(key: string, schema: z.ZodType<T>, fallback?: T): T {
    const value = env[key] === undefined ? fallback : env[key];
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw new ControlConfigError(`Invalid ${key}: ${parsed.error.message}`);
    return parsed.data;
  }
  const flag = z
    .union([z.literal('1'), z.literal('0'), z.boolean()])
    .transform((v) => v === '1' || v === true);
  const positive = z.coerce.number().finite().positive();
  const integer = positive.int();
  const control = overrides.control ?? parse('C9VIEW_CONTROL', flag, false);
  const bypass =
    overrides.bypass ?? parse('C9VIEW_CONTROL_BYPASS', flag, false);
  if (bypass && !control)
    throw new ControlConfigError(
      'Bypass requires control; enable C9VIEW_CONTROL=1 or disable C9VIEW_CONTROL_BYPASS',
    );
  return {
    control,
    bypass,
    claudeBin: parse('C9VIEW_CLAUDE_BIN', z.string().min(1).optional()),
    maxRuns: parse('C9VIEW_CONTROL_MAX_RUNS', integer, 3),
    idleMin: parse('C9VIEW_CONTROL_IDLE_MIN', positive, 10),
    approvalMin: parse('C9VIEW_CONTROL_APPROVAL_MIN', positive, 30),
    maxTurns: parse('C9VIEW_CONTROL_MAX_TURNS', integer.optional()),
    maxBudgetUsd: parse('C9VIEW_CONTROL_MAX_BUDGET_USD', positive.optional()),
    receiptMin: parse('C9VIEW_CONTROL_RECEIPT_MIN', positive, 10),
    tombstoneMax: parse('C9VIEW_CONTROL_TOMBSTONE_MAX', integer, 100000),
    textMaxChars: parse('C9VIEW_CONTROL_TEXT_MAX_CHARS', integer, 20000),
    workspaceRoots: parse('C9VIEW_WORKSPACE_ROOTS', z.string(), '')
      .split(delimiter)
      .filter(Boolean),
    cloneTimeoutMin: parse('C9VIEW_CLONE_TIMEOUT_MIN', positive, 10),
  };
}
export type ControlConfig = ReturnType<typeof loadControlConfig>;
export function assertWritableDirectory(path: string, label: string) {
  try {
    if (!statSync(path).isDirectory()) throw new Error('Not a directory');
    accessSync(path, constants.W_OK);
  } catch {
    throw new ControlConfigError(
      `${label} must be a writable directory; fix its permissions or choose a writable ${label}`,
    );
  }
}
/** Resolution only: never executes the binary or loads the SDK module. */
export function resolveClaudeBinary(
  config: ControlConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const usable = (path: string) => {
    try {
      accessSync(
        path,
        constants.R_OK | (path.endsWith('.js') ? 0 : constants.X_OK),
      );
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  if (config.claudeBin) {
    const path = resolve(config.claudeBin);
    if (usable(path)) return path;
    throw new ControlConfigError(
      'Claude Code executable not found; fix C9VIEW_CLAUDE_BIN',
    );
  }
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(directory, 'claude');
    if (usable(path)) return path;
  }
  const require = createRequire(import.meta.url);
  try {
    const entry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const sdkRequire = createRequire(entry);
    const musl =
      process.platform === 'linux' &&
      !(
        process.report?.getReport() as {
          header?: { glibcVersionRuntime?: string };
        }
      ).header?.glibcVersionRuntime;
    const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl ? '-musl' : ''}`;
    const path = sdkRequire.resolve(
      `${packageName}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`,
    );
    if (usable(path)) return path;
  } catch {
    /* Older SDK releases ship cli.js instead. */
  }
  try {
    const path = join(
      dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),
      'cli.js',
    );
    if (usable(path)) return path;
  } catch {
    /* No bundled binary. */
  }
  throw new ControlConfigError(
    'Claude Code executable not found; install claude or set C9VIEW_CLAUDE_BIN',
  );
}

export function claudeBinaryVersion(
  binary: string,
  env: NodeJS.ProcessEnv,
): string {
  try {
    return execFileSync(
      binary.endsWith('.js') ? process.execPath : binary,
      binary.endsWith('.js') ? [binary, '--version'] : ['--version'],
      {
        env,
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
      .trim()
      .slice(0, 200);
  } catch {
    throw new ControlConfigError(
      'Claude Code executable cannot run; fix C9VIEW_CLAUDE_BIN or install claude',
    );
  }
}

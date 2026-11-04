import { expect, it } from 'vitest';
import { hookCommand, updateHookSettings } from './settings.js';
it('quotes non-default state paths and replaces them on reinstall', () => {
  const command = hookCommand(
    '/tmp/node',
    '/tmp/entry.js',
    "/tmp/state folder's",
  );
  expect(command).toBe(
    "'/tmp/node' '/tmp/entry.js' --c9view-hook --c9view-state-dir '/tmp/state folder'\\''s'",
  );
  expect(hookCommand('/tmp/node', '/tmp/entry.js')).not.toContain(
    '--c9view-state-dir',
  );
  const next = hookCommand('/tmp/node', '/tmp/entry.js', '/tmp/replacement');
  const settings = updateHookSettings(
    updateHookSettings({}, command, true),
    next,
    true,
  );
  expect(JSON.stringify(settings)).not.toContain('state folder');
  expect(JSON.stringify(settings)).toContain('--c9view-state-dir');
  expect(updateHookSettings(settings, next, true)).toEqual(settings);
});

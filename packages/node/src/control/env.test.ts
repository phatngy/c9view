import { expect, it } from 'vitest';
import { childEnvironment } from './env.js';
it('T008 T092 strips hub secrets but retains owner login and resolves hook and Claude directories', () => {
  const env = childEnvironment(
    {
      C9VIEW_TOKEN: 'x',
      C9VIEW_PASSWORD: 'x',
      C9VIEW_HUB_ACCESS_CLIENT_ID: 'x',
      C9VIEW_HUB_ACCESS_CLIENT_SECRET: 'x',
      C9VIEW_FUTURE_KEY: 'x',
      C9VIEW_LEGACY_STATE_DIR: 'x',
      C9VIEW_CONTROL: '1',
      ANTHROPIC_API_KEY: 'owner',
      CLAUDE_CONFIG_DIR: 'owner-dir',
    },
    '/tmp/state',
  );
  expect(env).toEqual({
    ANTHROPIC_API_KEY: 'owner',
    CLAUDE_CONFIG_DIR: 'owner-dir',
    C9VIEW_STATE_DIR: '/tmp/state',
  });
  expect(
    childEnvironment({ C9VIEW_CLAUDE_DIR: '/tmp/x' }, '/tmp/state')
      .CLAUDE_CONFIG_DIR,
  ).toBe('/tmp/x');
});

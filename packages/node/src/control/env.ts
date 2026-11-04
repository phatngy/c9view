import { resolve } from 'node:path';
const stripped = new Set([
  'C9VIEW_TOKEN',
  'C9VIEW_PASSWORD',
  'C9VIEW_AUTH',
  'C9VIEW_HUB_ACCESS_CLIENT_ID',
  'C9VIEW_HUB_ACCESS_CLIENT_SECRET',
  'C9VIEW_INSECURE_NO_AUTH',
  'C9VIEW_CONTROL',
  'C9VIEW_CONTROL_BYPASS',
  'C9VIEW_ALLOWED_HOSTS',
  'C9VIEW_TRUST_PROXY',
  'C9VIEW_LEGACY_STATE_DIR',
]);
export function childEnvironment(
  env: NodeJS.ProcessEnv,
  stateDir: string,
): NodeJS.ProcessEnv {
  const child = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !stripped.has(key) &&
        !(
          key.startsWith('C9VIEW_') && /(TOKEN|SECRET|PASSWORD|KEY)$/.test(key)
        ),
    ),
  );
  child.C9VIEW_STATE_DIR = resolve(stateDir);
  if (env.C9VIEW_CLAUDE_DIR)
    child.CLAUDE_CONFIG_DIR = resolve(env.C9VIEW_CLAUDE_DIR);
  return child;
}

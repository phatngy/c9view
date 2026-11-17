// Shared constants for the control-on server (control-server.ts) and its specs.
// The token is synthetic, used only by this loopback test server.
export const controlBaseURL = 'http://127.0.0.1:7793';
// Test-only controller for fake terminal sessions, served by control-server.ts.
export const terminalControllerURL = 'http://127.0.0.1:7794';
export const controlToken = 'c9view-e2e-synthetic-token-0123456789abcdef';
export const controlProjectPath = '/m/local/projects/-synthetic-control';
export const controlSessionPath = (name: 'reply' | 'allow' | 'deny') =>
  `${controlProjectPath}/sessions/session-${name}`;
export const controlSessionPathFor = (sessionId: string) =>
  `${controlProjectPath}/sessions/${sessionId}`;
// Random per run: playwright.config.ts sets it in the runner's environment before
// the webServer starts and before workers fork, so both sides read the same value.
export const terminalToken = () => process.env.C9VIEW_E2E_TERMINAL_TOKEN ?? '';

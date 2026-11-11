// Shared constants for the control-on server (control-server.ts) and its specs.
// The token is synthetic, used only by this loopback test server.
export const controlBaseURL = 'http://127.0.0.1:7793';
export const controlToken = 'c9view-e2e-synthetic-token-0123456789abcdef';
export const controlProjectPath = '/m/local/projects/-synthetic-control';
export const controlSessionPath = (name: 'reply' | 'allow' | 'deny') =>
  `${controlProjectPath}/sessions/session-${name}`;

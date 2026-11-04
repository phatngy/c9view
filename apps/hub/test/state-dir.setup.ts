// Every hub test file gets its own empty c9view state folder, so no test reads
// or validates the developer's real ~/.claude/c9view. Tests that need a
// specific folder still set C9VIEW_STATE_DIR (or vi.stubEnv) themselves.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'c9view-hub-state-'));
process.env.C9VIEW_STATE_DIR = join(root, 'state');
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

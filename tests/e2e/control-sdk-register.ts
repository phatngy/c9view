// Test-only seam. Loaded with `node --import` by control-server.ts alone; the
// production CLI never loads it. It does nothing unless C9VIEW_E2E_FAKE_SDK=1
// is set, and then redirects only the Agent SDK import to the fake below, so
// no network, Claude binary or credentials are involved.
import { register } from 'node:module';

if (process.env.C9VIEW_E2E_FAKE_SDK === '1')
  register('./control-sdk-hooks.ts', import.meta.url);

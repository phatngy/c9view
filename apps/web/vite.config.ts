import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Records which modules the production build bundled, outside `dist`, so the
 * release script can list the third-party packages for THIRD-PARTY-NOTICES.txt.
 * It does not change the build output.
 */
function recordBundledModules(): Plugin {
  return {
    name: 'c9view-record-bundled-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = new Set<string>();
      for (const chunk of Object.values(bundle))
        if (chunk.type === 'chunk')
          for (const id of Object.keys(chunk.modules)) ids.add(id);
      const dir = join(process.cwd(), 'node_modules/.c9view');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'web-modules.json'),
        JSON.stringify([...ids].sort()),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), recordBundledModules()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:7777',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
});

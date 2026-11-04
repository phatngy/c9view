import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('self-hosted Plex fonts', () => {
  it('imports the used weights with swap and keeps system fallbacks', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');
    for (const family of ['sans', 'mono']) {
      for (const weight of [400, 500, 600]) {
        const path = `@fontsource/ibm-plex-${family}/${weight}.css`;
        expect(main).toContain(`import '${path}'`);
        const font = readFileSync(
          resolve(process.cwd(), 'node_modules', path),
          'utf8',
        );
        expect(font).toContain('font-display: swap');
        expect(font).not.toMatch(/https?:\/\//);
      }
    }
    expect(main).toContain("import '@fontsource/ibm-plex-sans/400-italic.css'");
    expect(main).not.toMatch(/inter|jetbrains/i);
    expect(css).toMatch(
      /--font-sans:\s*'IBM Plex Sans',\s*ui-sans-serif,\s*system-ui,\s*sans-serif/,
    );
    expect(css).toMatch(
      /--font-mono:\s*'IBM Plex Mono',\s*ui-monospace,\s*SFMono-Regular,\s*Menlo,\s*monospace/,
    );
    expect(css).toMatch(/body\s*\{[^}]*font-family: var\(--font-sans\)/);
  });
});

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const fixtureDir = resolve(repoRoot, 'packages/node/test-fixtures/boundaries');

describe('package import boundaries', () => {
  it('rejects every forbidden node import and allows an ordinary import', async () => {
    const eslint = new ESLint({ cwd: repoRoot, ignore: false });
    const forbidden = [
      'hono-cookie.ts',
      'hono-node-server.ts',
      'hono-node-server-serve.ts',
      'hub-package.ts',
      'hub-subpath.ts',
      'hub-relative.ts',
    ];

    for (const fixture of forbidden) {
      const [result] = await eslint.lintFiles([resolve(fixtureDir, fixture)]);

      expect(
        result?.messages.filter(
          (message) => message.ruleId === 'no-restricted-imports',
        ),
      ).toHaveLength(1);
    }

    const [allowed] = await eslint.lintFiles([
      resolve(fixtureDir, 'allowed.ts'),
    ]);
    expect(
      allowed?.messages.filter(
        (message) => message.ruleId === 'no-restricted-imports',
      ),
    ).toHaveLength(0);
  });

  it('rejects hub imports outside the @c9view/node package entry', async () => {
    const eslint = new ESLint({ cwd: repoRoot, ignore: false });
    const hubFile = resolve(repoRoot, 'apps/hub/src/boundaries.fixture.ts');

    for (const importPath of [
      '@c9view/node/src/app.js',
      '../../../packages/node/src/app.js',
    ]) {
      const [result] = await eslint.lintText(
        `import { createNodeApp } from '${importPath}';\nvoid createNodeApp;`,
        {
          filePath: hubFile,
        },
      );

      expect(
        result?.messages.filter(
          (message) => message.ruleId === 'no-restricted-imports',
        ),
      ).toHaveLength(1);
    }
  });
});

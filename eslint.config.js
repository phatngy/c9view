import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '.worktrees/**',
      'packages/node/test-fixtures/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ['playwright.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tests/e2e/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['packages/node/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'hono/cookie',
              message: 'Cookie handling belongs in the hub.',
            },
            {
              name: '@c9view/hub',
              message: 'The node package cannot depend on the hub.',
            },
          ],
          patterns: [
            {
              group: [
                '@hono/node-server',
                '@hono/node-server/*',
                '@c9view/hub/*',
                '**/apps/hub/**',
                'apps/hub/**',
              ],
              message:
                'The node package cannot depend on the hub or its server.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/hub/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@c9view/node/*',
                '**/packages/node/**',
                'packages/node/**',
              ],
              message: 'Import @c9view/node through its package entry.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);

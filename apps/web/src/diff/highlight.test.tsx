import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeLine } from './highlight.js';
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  load: vi.fn(async () => {}),
  tokens: vi.fn((text: string) => [
    [
      {
        content: text,
        variants: { light: { color: '#123456' }, dark: { color: '#abcdef' } },
      },
    ],
  ]),
}));
vi.mock('shiki/core', () => ({
  createHighlighterCore: mock.create.mockImplementation(async () => ({
    loadLanguage: mock.load,
    codeToTokensWithThemes: mock.tokens,
  })),
}));
vi.mock('shiki/langs', () => ({
  bundledLanguagesInfo: [{ id: 'typescript', aliases: ['ts'] }],
  bundledLanguages: { typescript: async () => 'typescript' },
}));
vi.mock('shiki/themes', () => ({
  bundledThemes: {
    'github-light': async () => 'light',
    'github-dark': async () => 'dark',
  },
}));
vi.mock('shiki/engine/javascript', () => ({
  createJavaScriptRegexEngine: () => 'javascript-regex',
}));
afterEach(cleanup);
it('lazily loads only the displayed language, shares the engine, and falls back for unknown or long lines', async () => {
  expect(mock.create).not.toHaveBeenCalled();
  render(
    <>
      <CodeLine text="const one = 1" language="ts" />
      <CodeLine text="const two = 2" language="ts" />
      <CodeLine text="unknown source" language="not-a-language" />
      <CodeLine text={'x'.repeat(2001)} language="typescript" />
    </>,
  );
  expect(screen.getByText('const one = 1')).toBeInTheDocument();
  // Each line highlights asynchronously; wait for both, not just the first.
  await waitFor(() => {
    expect(screen.getByText('const one = 1')).toHaveClass('syntax-token');
    expect(screen.getByText('const two = 2')).toHaveClass('syntax-token');
  });
  expect(mock.create).toHaveBeenCalledExactlyOnceWith({
    themes: ['light', 'dark'],
    langs: [],
    engine: 'javascript-regex',
  });
  expect(mock.load).toHaveBeenCalledExactlyOnceWith('typescript');
  expect(mock.tokens).toHaveBeenCalledTimes(2);
  expect(screen.getByText('const two = 2')).toHaveStyle({
    color: '#123456',
    '--syntax-dark': '#abcdef',
  });
  expect(screen.getByText('unknown source')).not.toHaveClass('syntax-token');
});

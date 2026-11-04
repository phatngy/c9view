import type { BundledLanguage } from 'shiki';
import type { HighlighterCore } from 'shiki/core';
import { useEffect, useState, type CSSProperties } from 'react';

type Token = {
  content: string;
  color?: string | undefined;
  dark?: string | undefined;
};
let engine:
  | Promise<HighlighterCore>
  | undefined;
const languages = new Map<string, Promise<BundledLanguage | undefined>>();
const cache = new Map<string, Promise<Token[] | undefined>>();
function highlight(text: string, language: string) {
  if (text.length > 2000 || !language || language === 'text')
    return Promise.resolve(undefined);
  const key = `${language}\0${text}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = (async () => {
    const [shiki, languageBundle, themeBundle, javascript] = await Promise.all([
      import('shiki/core'),
      import('shiki/langs'),
      import('shiki/themes'),
      import('shiki/engine/javascript'),
    ]);
    engine ??= (async () =>
      shiki.createHighlighterCore({
        themes: [
          await themeBundle.bundledThemes['github-light'](),
          await themeBundle.bundledThemes['github-dark'](),
        ],
        langs: [],
        engine: javascript.createJavaScriptRegexEngine(),
      }))();
    const highlighter = await engine;
    let loading = languages.get(language);
    if (!loading) {
      loading = (async () => {
        const info = languageBundle.bundledLanguagesInfo.find(
          (entry) => entry.id === language || entry.aliases?.includes(language),
        );
        if (!info) return undefined;
        await highlighter.loadLanguage(
          await languageBundle.bundledLanguages[info.id as BundledLanguage](),
        );
        return info.id as BundledLanguage;
      })();
      languages.set(language, loading);
    }
    const lang = await loading;
    if (!lang) return undefined;
    return highlighter
      .codeToTokensWithThemes(text, {
        lang,
        themes: { light: 'github-light', dark: 'github-dark' },
      })[0]
      ?.map((token) => ({
        content: token.content,
        color: token.variants.light?.color,
        dark: token.variants.dark?.color,
      }));
  })().catch(() => undefined);
  if (cache.size > 10000) cache.clear();
  cache.set(key, result);
  return result;
}
export function languageFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (
    (
      {
        ts: 'typescript',
        tsx: 'tsx',
        js: 'javascript',
        jsx: 'jsx',
        md: 'markdown',
        py: 'python',
        sh: 'bash',
        yml: 'yaml',
        rs: 'rust',
        rb: 'ruby',
        h: 'c',
        cs: 'csharp',
        kt: 'kotlin',
      } as Record<string, string>
    )[ext] ?? ext
  );
}
export function CodeLine({
  text,
  language,
}: {
  text: string;
  language: string;
}) {
  const [loaded, setLoaded] = useState<{
    text: string;
    language: string;
    tokens: Token[];
  }>();
  useEffect(() => {
    let active = true;
    void highlight(text, language).then((tokens) => {
      if (active && tokens) setLoaded({ text, language, tokens });
    });
    return () => {
      active = false;
    };
  }, [text, language]);
  const tokens =
    loaded?.text === text && loaded.language === language
      ? loaded.tokens
      : undefined;
  return (
    <code>
      {tokens
        ? tokens.map((token, index) => (
            <span
              key={index}
              className="syntax-token"
              style={
                {
                  color: token.color,
                  '--syntax-dark': token.dark ?? token.color,
                } as CSSProperties
              }
            >
              {token.content}
            </span>
          ))
        : text}
    </code>
  );
}

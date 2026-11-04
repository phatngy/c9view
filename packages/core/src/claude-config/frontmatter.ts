import { parse } from 'yaml';
import { clean, record, type JsonRecord } from './shared.js';

export interface FrontmatterDocument {
  frontmatter: JsonRecord;
  content: string;
}
/** Invalid or unterminated frontmatter remains ordinary document content. */
export function parseFrontmatter(text: string): FrontmatterDocument {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return clean({ frontmatter: {}, content: text });
  try {
    return clean({
      frontmatter: record(parse(match[1] ?? '', { maxAliasCount: 50 })),
      content: text.slice(match[0].length),
    });
  } catch {
    return clean({ frontmatter: {}, content: text });
  }
}

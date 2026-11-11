import { ControlError } from '../control/errors.js';

declare const parsed: unique symbol;
/** A git URL that passed `parseGitUrl`; the only kind `git-write.ts` accepts. */
export type ParsedGitUrl = string & { readonly [parsed]: true };

const user = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const name = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const ipv6 = /^\[[0-9A-Fa-f:.]+\]$/;
const scp =
  /^([A-Za-z0-9._][A-Za-z0-9._-]*)@(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9.-]*):(.+)$/;

const bad = () => new ControlError(400, 'Invalid git URL', 'bad-url');
const hostOk = (host: string) => name.test(host) || ipv6.test(host);

/**
 * Accepts `https://`, `ssh://` and scp-like `user@host:path` only. The
 * returned string is rebuilt from the parsed parts, and is what reaches git.
 */
export function parseGitUrl(raw: string): ParsedGitUrl {
  // eslint-disable-next-line no-control-regex
  if (raw.length === 0 || raw.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(raw))
    throw bad();
  if (raw.includes('://')) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw bad();
    }
    if (url.protocol !== 'https:' && url.protocol !== 'ssh:') throw bad();
    if (url.password || url.search || url.hash) throw bad();
    if (url.username && !user.test(url.username)) throw bad();
    if (!hostOk(url.hostname)) throw bad();
    if (url.pathname.length < 2) throw bad();
    return `${url.protocol}//${url.username ? `${url.username}@` : ''}${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}` as ParsedGitUrl;
  }
  const match = scp.exec(raw);
  if (!match) throw bad();
  const [, who, host, path] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  if (!user.test(who) || !hostOk(host) || path.startsWith('-')) throw bad();
  return `${who}@${host}:${path}` as ParsedGitUrl;
}

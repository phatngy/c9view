import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  );
}
export function validateRelative(path: string): void {
  // URL decoding belongs to HTTP. Refuse encoded separators/traversal too, so
  // callers cannot accidentally turn an already checked path into an escape.
  if (
    path.includes('\0') ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes('\\') ||
    /%(?:00|2e|2f|5c)/i.test(path) ||
    !inside(resolve('/project'), resolve('/project', path))
  )
    throw new Error('Unsafe path');
}
// Project-relative policy. claude-config retains its separate absolute include policy.
export function deniedPath(
  path: string,
  extra: readonly string[] = [],
): boolean {
  return path
    .split(/[\\/]/)
    .some(
      (part) =>
        /^(?:\.ssh|\.gnupg|\.aws|\.codex|\.config|\.kube|\.docker)$/.test(
          part,
        ) ||
        /^(?:\.credentials\.json|auth\.json|\.netrc|\.npmrc|\.pypirc|\.env.*|\.claude\.json)$/.test(
          part,
        ) ||
        /^id_(rsa|dsa|ecdsa|ed25519)/.test(part) ||
        /^\.git$/i.test(part) ||
        /\.(?:pem|key)$/i.test(part) ||
        extra.includes(part) ||
        extra.includes(path),
    );
}
export function isBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true;
  let controls = 0;
  for (const byte of bytes)
    if (byte < 8 || (byte > 13 && byte < 32)) controls++;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return true;
  }
  return controls / Math.max(1, bytes.length) > 0.1;
}

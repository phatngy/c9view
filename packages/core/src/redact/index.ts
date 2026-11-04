/** Secret masking deliberately avoids entropy-only matching: hashes and UUIDs are public data. */
const mask = (kind: string): string => `«redacted:${kind}»`;
const patterns: readonly [string, RegExp][] = [
  [
    'private-key',
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  ],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{10,}/g],
  ['openai', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ['aws', /\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b/g],
  ['google', /\bAIza[A-Za-z0-9_-]{30,}/g],
  ['google', /\bya29\.[A-Za-z0-9_-]+/g],
  ['slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['stripe', /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
];

export function redactText(text: string): string {
  // Preserve our markers, including on repeated passes through nested readers.
  const saved: string[] = [];
  const protect = (value: string): string =>
    `\uE000REDACT${saved.push(value) - 1}\uE000`;
  let result = text.replace(/«redacted:[^»]+»/g, protect);
  result = result.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi,
    (_all, scheme: string) => `${scheme}${protect(mask('url-credentials'))}@`,
  );
  result = result.replace(
    /\b(Digest)([ \t]+)((?:[a-z][a-z0-9_-]*=(?:"(?:\\.|[^"\\\r\n])*"|[^\s,;"']+)(?:,[ \t]*)?)+)/gi,
    (_all, scheme: string, space: string) =>
      `${scheme}${space}${protect(mask('digest'))}`,
  );
  result = result.replace(
    /\b(Basic|Bearer|Token|Digest)([ \t]+)([^=\s"'`,;<>][^\s"'`,;<>]*)/gi,
    (_all, scheme: string, space: string, credential: string) =>
      `${scheme}${space}${credential.startsWith('\uE000') ? credential : protect(mask(scheme.toLowerCase()))}`,
  );
  result = result.replace(
    /((?:^|[\s"'])--?(?:api[-_]?key|token|secret|password|auth)(?:=|[ \t]+))("[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi,
    (_all, prefix: string) => `${prefix}${protect(mask('flag'))}`,
  );
  result = result.replace(
    /([?&](?:key|api_key|apikey|token|sig|signature|auth|access_token|password)=)[^&#\s"'<>]+/gi,
    (_all, prefix: string) => `${prefix}${protect(mask('query'))}`,
  );
  result = result.replace(
    /\b([\w-]+["']?\s*[:=]\s*)("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|[^\s,;&}\])"']+)/g,
    (all, prefix: string, value: string, offset: number, input: string) => {
      const key = /^[\w-]+/.exec(prefix)?.[0] ?? '';
      if (!isSensitiveKey(key)) return all;
      const quoted = value.startsWith('"') || value.startsWith("'");
      const literal = quoted
        ? value.slice(1, -1).length >= 8
        : /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_+/=.-]{12,}$/.test(value) &&
          !/[.(;]/.test(input[offset + all.length] ?? '') &&
          !/^(?:process|import|this|globalThis)\./.test(value) &&
          !(
            prefix.includes(':') &&
            /(?:const|let|var)\s+$/.test(input.slice(0, offset))
          ) &&
          !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value);
      return literal ? `${prefix}${protect(mask('assignment'))}` : all;
    },
  );
  for (const [kind, pattern] of patterns)
    result = result.replace(pattern, () => protect(mask(kind)));
  return result.replace(
    /\uE000REDACT(\d+)\uE000/g,
    (_all, index: string) => saved[Number(index)] ?? '',
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (/(?:^|_)tokens$/.test(normalized) || normalized === 'token') return false;
  return (
    /(?:^|[_-])(?:secrets?|password|passwd|api[_-]?key|authorization|credentials?|cookies?|private|access[_-]?key)(?:$|[_-])/.test(
      normalized,
    ) || /(?:^|[_-])[a-z0-9]+[_-]token(?:$|[_-])/.test(normalized)
  );
}

/** Returns a detached JSON-like value. Sensitive keys and every env value are masked. */
export function redactValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  function visit(input: unknown, underEnv = false): unknown {
    if (typeof input === 'string')
      return underEnv ? mask('env') : redactText(input);
    if (input === null || typeof input !== 'object')
      return underEnv ? mask('env') : input;
    if (seen.has(input)) return mask('cycle');
    seen.add(input);
    let output: unknown;
    if (Array.isArray(input))
      output = input.map((entry) => visit(entry, underEnv));
    else
      output = Object.fromEntries(
        Object.entries(input).map(([key, entry]) => [
          redactText(key),
          typeof entry === 'string' && isSensitiveKey(key)
            ? mask('key')
            : visit(entry, underEnv || key.toLowerCase() === 'env'),
        ]),
      );
    seen.delete(input);
    return output;
  }
  return visit(value);
}

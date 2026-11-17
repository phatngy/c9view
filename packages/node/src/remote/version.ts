/** First Claude Code version the 003 spike verified end to end (FR-017). */
export const REMOTE_MIN_VERSION = '2.1.318';

/** Strict `major.minor.patch`; any suffix or other shape is unparsable. */
export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True only for a parsable version at or above the minimum; unknown fails closed. */
export function meetsMinimum(
  value: unknown,
  minimum: string = REMOTE_MIN_VERSION,
): boolean {
  const version = parseVersion(value);
  const floor = parseVersion(minimum);
  if (!version || !floor) return false;
  for (let i = 0; i < 3; i++) {
    if (version[i]! !== floor[i]!) return version[i]! > floor[i]!;
  }
  return true;
}

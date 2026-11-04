import { redactText } from '@c9view/core';

const safe = new WeakSet<object>();
/** Mark only immutable values that have already passed the string guard. */
export function redacted<T extends object>(value: T): T {
  safe.add(value);
  return value;
}
/** Retain a final guard for config/metadata; cached message objects are skipped. */
export function redactStrings<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (value && typeof value === 'object') {
    if (safe.has(value)) return value;
    if (Array.isArray(value)) return value.map(redactStrings) as T;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactText(key),
        redactStrings(entry),
      ]),
    ) as T;
  }
  return value;
}

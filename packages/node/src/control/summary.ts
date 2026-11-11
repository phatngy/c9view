import { redactStrings } from '../data/redaction.js';

const MAX = 600;
const FIELD = 300;
const DIFF_LINES = 6;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function head(value: string, lines: number): string {
  const all = value.split('\n');
  const kept = all.slice(0, lines).join('\n');
  return all.length > lines ? `${kept}\n…` : kept;
}

/** Tool-row style one-liner: the fields that matter, never the raw input. */
export function approvalSummary(
  tool: string,
  input: Record<string, unknown>,
): string {
  const parts: string[] = [];
  const command = text(input.command);
  const file =
    text(input.file_path) ?? text(input.path) ?? text(input.notebook_path);
  if (command) parts.push(clip(command, FIELD));
  if (file) parts.push(clip(file, FIELD));
  const diff =
    text(input.new_string) ?? text(input.content) ?? text(input.new_source);
  if (diff) parts.push(head(clip(diff, FIELD), DIFF_LINES));
  const other =
    text(input.pattern) ??
    text(input.url) ??
    text(input.query) ??
    text(input.description);
  if (other && !parts.length) parts.push(clip(other, FIELD));
  const body = parts.join('\n');
  return clip(redactStrings(body ? `${tool}: ${body}` : tool), MAX);
}

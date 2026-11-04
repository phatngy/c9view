import {
  isAssistantRecord,
  type RawTokenUsage,
  type TranscriptRecord,
} from './schemas.js';

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  thinking: number;
  webSearch: number;
  webFetch: number;
}
export function emptyUsage(): TokenUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    cacheCreation5m: 0,
    cacheCreation1h: 0,
    thinking: 0,
    webSearch: 0,
    webFetch: 0,
  };
}
/** Returns a fresh sum; never mutates either operand. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const result = emptyUsage();
  for (const key of Object.keys(result) as (keyof TokenUsage)[])
    result[key] = a[key] + b[key];
  return result;
}
export function extractUsage(
  usage: RawTokenUsage | null | undefined,
): TokenUsage {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheCreation: usage?.cache_creation_input_tokens ?? 0,
    cacheCreation5m: usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    cacheCreation1h: usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    thinking: usage?.output_tokens_details?.thinking_tokens ?? 0,
    webSearch: usage?.server_tool_use?.web_search_requests ?? 0,
    webFetch: usage?.server_tool_use?.web_fetch_requests ?? 0,
  };
}
export interface UsageSummary {
  total: TokenUsage;
  byModel: Record<string, TokenUsage>;
}
export function summarizeUsage(
  records: Iterable<TranscriptRecord>,
): UsageSummary {
  const messages = new Map<string, { model: string; usage: TokenUsage }>();
  for (const record of records) {
    if (!isAssistantRecord(record)) continue;
    const key = JSON.stringify([record.message.id, record.requestId ?? null]);
    messages.set(key, {
      model: record.message.model,
      usage: extractUsage(record.message.usage),
    });
  }
  let total = emptyUsage();
  const byModel: Record<string, TokenUsage> = Object.create(null) as Record<
    string,
    TokenUsage
  >;
  for (const { model, usage } of messages.values()) {
    total = addUsage(total, usage);
    byModel[model] = addUsage(byModel[model] ?? emptyUsage(), usage);
  }
  return { total, byModel };
}

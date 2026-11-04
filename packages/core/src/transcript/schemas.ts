import { z } from 'zod';

export const textBlockSchema = z
  .object({ type: z.literal('text'), text: z.string() })
  .passthrough();
export const unknownBlockSchema = z.object({ type: z.string() }).passthrough();
export const imageSourceSchema = z.union([
  z
    .object({
      type: z.literal('base64'),
      media_type: z.string(),
      data: z.string(),
    })
    .passthrough(),
  z.object({ type: z.literal('url'), url: z.string() }).passthrough(),
  unknownBlockSchema,
]);
export const imageBlockSchema = z
  .object({
    type: z.literal('image'),
    source: imageSourceSchema,
  })
  .passthrough();
export const toolResultBlockSchema = z
  .object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z
      .union([
        z.string(),
        z.array(
          z.union([textBlockSchema, imageBlockSchema, unknownBlockSchema]),
        ),
      ])
      .optional(),
    is_error: z.boolean().optional(),
  })
  .passthrough();
export const thinkingBlockSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(),
  })
  .passthrough();
export const toolUseBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  })
  .passthrough();
// New block kinds must not make an otherwise valid message disappear.
export const userContentBlockSchema = z.union([
  textBlockSchema,
  toolResultBlockSchema,
  imageBlockSchema,
  unknownBlockSchema,
]);
export const assistantContentBlockSchema = z.union([
  textBlockSchema,
  thinkingBlockSchema,
  toolUseBlockSchema,
  unknownBlockSchema,
]);

const count = z.number().nonnegative().nullish();
export const usageSchema = z
  .object({
    input_tokens: count,
    output_tokens: count,
    cache_read_input_tokens: count,
    cache_creation_input_tokens: count,
    output_tokens_details: z
      .object({ thinking_tokens: count })
      .passthrough()
      .nullish(),
    server_tool_use: z
      .object({ web_search_requests: count, web_fetch_requests: count })
      .passthrough()
      .nullish(),
    cache_creation: z
      .object({
        ephemeral_5m_input_tokens: count,
        ephemeral_1h_input_tokens: count,
      })
      .passthrough()
      .nullish(),
    iterations: z.unknown().nullish(),
  })
  .passthrough();

const envelope = {
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  isSidechain: z.boolean().optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  version: z.string().optional(),
  entrypoint: z.string().optional(),
  isMeta: z.boolean().optional(),
  promptId: z.string().optional(),
};

export const userRecordSchema = z
  .object({
    ...envelope,
    type: z.literal('user'),
    message: z
      .object({
        role: z.literal('user').optional(),
        content: z.union([z.string(), z.array(userContentBlockSchema)]),
      })
      .passthrough(),
  })
  .passthrough();
export const assistantRecordSchema = z
  .object({
    ...envelope,
    type: z.literal('assistant'),
    requestId: z.string().optional(),
    message: z
      .object({
        id: z.string(),
        model: z.string(),
        role: z.literal('assistant').optional(),
        content: z.array(assistantContentBlockSchema),
        usage: usageSchema.nullish().catch(undefined),
      })
      .passthrough(),
  })
  .passthrough();
export const aiTitleRecordSchema = z
  .object({ ...envelope, type: z.literal('ai-title'), aiTitle: z.string() })
  .passthrough();
export const permissionModeRecordSchema = z
  .object({
    ...envelope,
    type: z.literal('permission-mode'),
    permissionMode: z.string(),
  })
  .passthrough();
export const systemRecordSchema = z
  .object({
    ...envelope,
    type: z.literal('system'),
    subtype: z.string().optional(),
    content: z.string().optional(),
    level: z.string().optional(),
    durationMs: z.number().optional(),
    toolUseID: z.string().optional(),
  })
  .passthrough();
export const knownTranscriptRecordSchema = z.discriminatedUnion('type', [
  userRecordSchema,
  assistantRecordSchema,
  aiTitleRecordSchema,
  permissionModeRecordSchema,
  systemRecordSchema,
]);
export const genericRecordSchema = z.object({ type: z.string() }).passthrough();
export const transcriptRecordSchema = z.union([
  knownTranscriptRecordSchema,
  genericRecordSchema,
]);
export type KnownTranscriptRecord = z.infer<typeof knownTranscriptRecordSchema>;
export type GenericTranscriptRecord = z.infer<typeof genericRecordSchema>;
// The open string fallback overlaps known discriminants; use the guards below
// when narrowing records that may have unrecognized or invalid known shapes.
export type TranscriptRecord = KnownTranscriptRecord | GenericTranscriptRecord;
export type UserRecord = z.infer<typeof userRecordSchema>;
export type AssistantRecord = z.infer<typeof assistantRecordSchema>;
export type RawTokenUsage = z.infer<typeof usageSchema>;

const parsedRecordKind = Symbol('parsed transcript record kind');
type ParsedRecordKind = { [parsedRecordKind]?: 'user' | 'assistant' };

export function parseRecord(json: unknown): TranscriptRecord {
  const parsed = transcriptRecordSchema.safeParse(json);
  if (parsed.success) {
    if (parsed.data.type === 'user' || parsed.data.type === 'assistant') {
      Object.defineProperty(parsed.data, parsedRecordKind, {
        value: parsed.data.type,
      });
    }
    return parsed.data;
  }
  return { type: 'unknown', value: json };
}

export function isUserRecord(record: TranscriptRecord): record is UserRecord {
  return (
    record.type === 'user' &&
    (record as TranscriptRecord & ParsedRecordKind)[parsedRecordKind] === 'user'
  );
}
export function isAssistantRecord(
  record: TranscriptRecord,
): record is AssistantRecord {
  return (
    record.type === 'assistant' &&
    (record as TranscriptRecord & ParsedRecordKind)[parsedRecordKind] ===
      'assistant'
  );
}

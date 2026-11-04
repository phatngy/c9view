import { describe, expect, it } from 'vitest';
import {
  isAssistantRecord,
  isUserRecord,
  parseRecord,
  knownTranscriptRecordSchema,
} from './schemas.js';
import { summarizeSession } from './summary.js';
import { addUsage, emptyUsage, summarizeUsage } from './usage.js';

function assistant(
  id: string,
  output: number,
  extra: Record<string, unknown> = {},
  model = 'model-a',
) {
  return parseRecord({
    type: 'assistant',
    sessionId: 'session-1',
    message: {
      id,
      model,
      content: [
        { type: 'tool_use', id: `tool-${id}`, name: 'Read', input: {} },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: output,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 7,
        cache_creation: {
          ephemeral_5m_input_tokens: 3,
          ephemeral_1h_input_tokens: 4,
        },
        output_tokens_details: { thinking_tokens: 1 },
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 3 },
      },
    },
    ...extra,
  });
}

describe('usage', () => {
  it('keeps the last usage per message/request and aggregates per model', () => {
    const records = [
      assistant('a', 1, { requestId: 'r1' }),
      assistant('a', 9, { requestId: 'r1' }),
      assistant('a', 3, { requestId: 'r2' }),
      assistant('b', 4, {}, 'model-b'),
    ];
    const result = summarizeUsage(records);
    expect(result.total).toEqual({
      input: 30,
      output: 16,
      cacheRead: 6,
      cacheCreation: 21,
      cacheCreation5m: 9,
      cacheCreation1h: 12,
      thinking: 3,
      webSearch: 6,
      webFetch: 9,
    });
    expect(result.byModel['model-a']?.output).toBe(12);
    expect(result.byModel['model-b']?.output).toBe(4);
    expect(
      summarizeUsage([assistant('a', 1), assistant('a', 9)]).total.output,
    ).toBe(9);
  });
  it('does not mutate operands and treats missing usage as zero', () => {
    const a = emptyUsage();
    expect(addUsage(a, { ...a, input: 2 }).input).toBe(2);
    expect(a.input).toBe(0);
    expect(
      summarizeUsage([
        parseRecord({
          type: 'assistant',
          message: { id: 'a', model: '__proto__', content: [] },
        }),
      ]).total,
    ).toEqual(emptyUsage());
  });
});

describe('session summary', () => {
  it('falls back to the first real prompt, skips meta/tool results, and truncates to 120 characters', () => {
    const prompt = 'x'.repeat(130);
    const records = [
      parseRecord({
        type: 'user',
        isMeta: true,
        message: { content: 'internal' },
      }),
      parseRecord({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't',
              content: 'output',
              is_error: true,
            },
          ],
        },
      }),
      parseRecord({
        type: 'user',
        message: { content: [{ type: 'text', text: prompt }] },
      }),
    ];
    expect(summarizeSession(records).title).toBe('x'.repeat(120));
    expect(summarizeSession(records).errorCount).toBe(1);
  });
  it('skips harness and command noise and removes embedded harness tag blocks', () => {
    const records = [
      ...[
        '<command-name>tool</command-name>',
        '<command-message>run</command-message>',
        '<command-args>{}</command-args>',
        '<local-command-stdout>output</local-command-stdout>',
        '<local-command-caveat>note</local-command-caveat>',
        '<system-reminder>reminder</system-reminder>',
        'Caveat: generated context',
        '[Request interrupted by user]',
      ].map((content) => parseRecord({ type: 'user', message: { content } })),
      parseRecord({
        type: 'user',
        message: {
          content:
            '<system-reminder>ignore this</system-reminder>\n  \nPlease inspect <command-name>ignored</command-name> the parser',
        },
      }),
    ];
    expect(summarizeSession(records).title).toBe('Please inspect  the parser');
  });
  it('uses the latest title, dedupes assistant turns/tools, and collects metadata', () => {
    const records = [
      parseRecord({
        type: 'user',
        message: { content: 'Prompt' },
        timestamp: '2026-01-02T00:00:00Z',
        gitBranch: 'main',
        cwd: '/workspace/example',
        version: '1',
      }),
      assistant('a', 1, { timestamp: '2026-01-01T00:00:00Z' }),
      assistant('a', 9),
      assistant(
        'b',
        4,
        {
          timestamp: '2026-01-03T00:00:00Z',
          gitBranch: 'feature',
          version: '2',
        },
        'model-b',
      ),
      parseRecord({ type: 'ai-title', aiTitle: 'Old' }),
      parseRecord({ type: 'ai-title', aiTitle: 'New' }),
      parseRecord({ type: 'permission-mode', permissionMode: 'default' }),
      parseRecord({ type: 'permission-mode', permissionMode: 'default' }),
      parseRecord({ type: 'permission-mode', permissionMode: 'plan' }),
    ];
    const result = summarizeSession(records, { malformed: 2 });
    expect(result).toMatchObject({
      sessionId: 'session-1',
      title: 'New',
      messageCount: 3,
      toolUseCounts: { Read: 2 },
      models: ['model-a', 'model-b'],
      gitBranches: ['main', 'feature'],
      cwd: '/workspace/example',
      version: '2',
      permissionModes: ['default', 'plan'],
      firstAt: '2026-01-01T00:00:00Z',
      lastAt: '2026-01-03T00:00:00Z',
      malformed: 2,
    });
    expect(result.usage.total.output).toBe(13);
  });
  it('returns an empty summary for empty input', () => {
    expect(summarizeSession([])).toMatchObject({
      title: undefined,
      messageCount: 0,
      malformed: 0,
      models: [],
      usage: { total: emptyUsage() },
    });
  });
});

describe('schemas', () => {
  it('keeps unknown record types and fields and tolerates evolving known shapes', () => {
    const future = { type: 'future', nested: { value: 1 } };
    expect(parseRecord(future)).toEqual(future);
    const known = {
      type: 'user',
      parentUuid: null,
      message: { content: [{ type: 'new-block', value: 1 }], extra: true },
      custom: 2,
    };
    expect(knownTranscriptRecordSchema.parse(known)).toEqual(known);
    expect(parseRecord({ type: 'assistant', message: null })).toEqual({
      type: 'assistant',
      message: null,
    });
    expect(parseRecord(null)).toEqual({ type: 'unknown', value: null });
  });
  it('retains assistant records with null usage details and ignores invalid usage blocks', () => {
    const record = parseRecord({
      type: 'assistant',
      message: {
        id: 'a',
        model: 'model-a',
        content: [],
        usage: {
          input_tokens: null,
          output_tokens: 5,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: 1,
          output_tokens_details: null,
          server_tool_use: null,
          cache_creation: null,
          iterations: null,
        },
      },
    });
    expect(record.type).toBe('assistant');
    expect(summarizeSession([record])).toMatchObject({
      messageCount: 1,
      models: ['model-a'],
      usage: { total: { output: 5, cacheCreation: 1 } },
    });
    const invalidUsage = parseRecord({
      type: 'assistant',
      message: {
        id: 'b',
        model: 'model-b',
        content: [],
        usage: 'unexpected',
      },
    });
    expect(summarizeSession([invalidUsage])).toMatchObject({
      messageCount: 1,
      models: ['model-b'],
    });
  });
  it('marks validated user and assistant records for cheap guards', () => {
    const user = parseRecord({ type: 'user', message: { content: 'hello' } });
    const assistantRecord = parseRecord({
      type: 'assistant',
      message: { id: 'a', model: 'model-a', content: [] },
    });
    expect(isUserRecord(user)).toBe(true);
    expect(isAssistantRecord(assistantRecord)).toBe(true);
    expect(
      isAssistantRecord({
        type: 'assistant',
        message: { id: 'a', model: 'model-a', content: [] },
      }),
    ).toBe(false);
  });
});

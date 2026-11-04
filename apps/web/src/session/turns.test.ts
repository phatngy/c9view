import { describe, expect, it } from 'vitest';
import type { Message, TokenTotals } from '@c9view/api';
import { buildTurns } from './turns.js';

const usage: TokenTotals = {
  input: 100,
  output: 30,
  cacheRead: 900,
  cacheCreation: 200,
  thinking: 10,
};
function message(
  uuid: string,
  role: Message['role'],
  overrides: Partial<Message> = {},
): Message {
  return {
    uuid,
    role,
    timestamp: null,
    model: null,
    isMeta: false,
    isSidechain: false,
    blocks: [{ type: 'text', text: uuid }],
    usage: role === 'assistant' ? usage : null,
    ...overrides,
  };
}
const thinking = (uuid: string, timestamp: string | null) =>
  message(uuid, 'assistant', {
    timestamp,
    blocks: [{ type: 'thinking', text: '' }],
  });

describe('turn summaries', () => {
  it('counts repeated thinking, tool and text usage once per request using the last usage', () => {
    const { turns } = buildTurns([
      message('prompt', 'user'),
      thinking('thinking', null),
      message('tool', 'assistant', {
        blocks: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }],
      }),
      message('answer', 'assistant', { usage: { ...usage, output: 40 } }),
    ]);
    expect(turns).toEqual([
      {
        startId: 'prompt',
        endId: 'answer',
        endAt: null,
        requests: 1,
        output: 40,
        fresh: 300,
        input: 1200,
        cacheRead: 900,
        cacheHit: 0.75,
      },
    ]);
  });
  it('sums requests separated by tool results and excludes sidechains', () => {
    const { turns } = buildTurns([
      message('prompt', 'user'),
      message('first', 'assistant'),
      message('result', 'user', {
        blocks: [
          { type: 'tool_result', toolUseId: 't', text: 'ok', isError: false },
        ],
      }),
      message('second', 'assistant'),
      message('agent', 'assistant', {
        isSidechain: true,
        usage: { ...usage, output: 999 },
      }),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      requests: 2,
      output: 60,
      fresh: 600,
      input: 2400,
      cacheRead: 1800,
      cacheHit: 0.75,
    });
  });
  it('has null cacheHit for zero input and keeps turn zero when it has usage', () => {
    const { turns } = buildTurns([
      message('before', 'assistant', {
        usage: { ...usage, input: 0, cacheCreation: 0, cacheRead: 0 },
      }),
      message('prompt', 'user'),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ requests: 1, cacheHit: null });
    expect(turns[1]).toMatchObject({ requests: 0, cacheHit: null });
    expect(buildTurns([]).turns).toEqual([]);
  });
  it('ignores commands, local output, task notifications and meta messages as boundaries', () => {
    const { turns } = buildTurns([
      message('one', 'user'),
      message('a', 'assistant'),
      message('command', 'user', {
        blocks: [{ type: 'text', text: '<command-name>model</command-name>' }],
      }),
      message('stdout', 'user', {
        blocks: [
          {
            type: 'text',
            text: '<local-command-stdout>ok</local-command-stdout>',
          },
        ],
      }),
      message('task', 'user', {
        blocks: [
          { type: 'text', text: '<task-notification>ok</task-notification>' },
        ],
      }),
      message('meta', 'user', { isMeta: true }),
      message('b', 'assistant'),
      message('two', 'user'),
      message('c', 'assistant'),
    ]);
    expect(
      turns.map((turn) => [turn.startId, turn.endId, turn.requests]),
    ).toEqual([
      ['one', 'b', 2],
      ['two', 'c', 1],
    ]);
  });
  it('counts assistant requests without usage after prompts but suppresses a usage-free prefix', () => {
    const { turns } = buildTurns([
      message('prefix', 'assistant', { usage: null }),
      message('prompt', 'user'),
      message('first', 'assistant', { usage: null }),
      message('same-request', 'assistant', { usage: null }),
      message('result', 'user', {
        blocks: [
          { type: 'tool_result', toolUseId: 't', text: 'ok', isError: false },
        ],
      }),
      message('second', 'assistant', { usage: null }),
    ]);
    expect(turns[0]).toMatchObject({ requests: 0 });
    expect(turns[1]).toMatchObject({
      requests: 2,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheHit: null,
    });
  });
  it('assigns the maximum repeated thinking usage only to the first thinking record in a response', () => {
    const { thinkingTokens } = buildTurns([
      message('prompt', 'user'),
      thinking('first', null),
      thinking('second', null),
      thinking('third', null),
      message('answer', 'assistant', { usage: { ...usage, thinking: 25 } }),
    ]);
    expect([...thinkingTokens]).toEqual([['first', 25]]);
  });
  it('keeps thinking usage separate for responses and excludes sidechains', () => {
    const { thinkingTokens } = buildTurns([
      thinking('first', null),
      message('result', 'user', {
        blocks: [
          { type: 'tool_result', toolUseId: 't', text: 'ok', isError: false },
        ],
      }),
      thinking('second', null),
      message('agent', 'assistant', {
        isSidechain: true,
        blocks: [{ type: 'thinking', text: 'Nested' }],
        usage: { ...usage, thinking: 999 },
      }),
    ]);
    expect([...thinkingTokens]).toEqual([
      ['first', 10],
      ['second', 10],
    ]);
  });
  it('derives thinking times from the immediately previous full-list message', () => {
    const { thinkingDurations } = buildTurns([
      message('prompt', 'user', { timestamp: '2026-01-01T13:55:38.727Z' }),
      thinking('five', '2026-01-01T13:55:43.986Z'),
      thinking('negative', '2026-01-01T13:55:40.000Z'),
      thinking('idle', '2026-01-01T14:10:40.000Z'),
      thinking('missing', null),
      thinking('no-previous-time', '2026-01-01T14:10:45.000Z'),
      thinking('zero', '2026-01-01T14:10:45.000Z'),
    ]);
    expect([...thinkingDurations]).toEqual([['five', 5259]]);
    expect(
      buildTurns([thinking('first', '2026-01-01T00:00:00Z')]).thinkingDurations
        .size,
    ).toBe(0);
  });
});

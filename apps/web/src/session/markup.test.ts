import { describe, expect, it } from 'vitest';
import type { Message } from '@c9view/api';
import {
  classifyMessage,
  parseAssistantNotices,
  parseMarkup,
  stripAnsi,
} from './markup.js';
import { outlineEntries, searchableText } from './model.js';
import { buildTurns } from './turns.js';

function message(text: string, overrides: Partial<Message> = {}): Message {
  return {
    uuid: 'm',
    role: 'user',
    timestamp: null,
    model: null,
    isMeta: false,
    isSidechain: false,
    blocks: [{ type: 'text', text }],
    usage: null,
    ...overrides,
  };
}

describe('Claude Code markup', () => {
  it.each([
    [
      '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>',
      [{ kind: 'command', name: '/model', args: 'opus' }],
    ],
    [
      '<command-name>context</command-name><command-args></command-args>',
      [{ kind: 'command', name: '/context', args: '' }],
    ],
    [
      '<local-command-stdout>Set model to `Opus 5.5`</local-command-stdout>',
      [{ kind: 'stdout', text: 'Set model to `Opus 5.5`', lines: 1 }],
    ],
    [
      '<local-command-stdout> \u001b[1mContext Usage\u001b[22m\n⛁ ⛁</local-command-stdout>',
      [{ kind: 'stdout', text: 'Context Usage\n⛁ ⛁', lines: 2 }],
    ],
    [
      '\n\n<pasted_content id="0a18">\nline1\nline2\n</pasted_content id="0a18">\n',
      [{ kind: 'pasted', id: '0a18', text: 'line1\nline2', lines: 2 }],
    ],
    [
      'Fix this:\n<pasted_content>a\nb</pasted_content>',
      [
        { kind: 'text', text: 'Fix this:' },
        { kind: 'pasted', id: null, text: 'a\nb', lines: 2 },
      ],
    ],
    [
      '<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n<summary>Background command "Run tests" completed (exit code 0)</summary>\n</task-notification>',
      [
        {
          kind: 'task',
          status: 'completed',
          summary: 'Background command "Run tests" completed (exit code 0)',
        },
      ],
    ],
    [
      'Use <foo>bar</foo> & <b>',
      [{ kind: 'text', text: 'Use <foo>bar</foo> & <b>' }],
    ],
    [
      '<pasted_content id="1">never closed',
      [{ kind: 'pasted', id: '1', text: 'never closed', lines: 1 }],
    ],
    ['<local-command-caveat>…</local-command-caveat>', []],
    ['<system-reminder>hidden</system-reminder>', []],
    ['<local-command-stdout> \n </local-command-stdout>', []],
    [
      '<TASK-NOTIFICATION><status>failed</status></TASK-NOTIFICATION>',
      [{ kind: 'task', status: 'failed', summary: 'Background task update' }],
    ],
  ])('parses %s', (text, expected) =>
    expect(parseMarkup(text as string)).toEqual(expected),
  );

  it('prefers a matching pasted id and falls back to any closing tag', () => {
    expect(
      parseMarkup(
        '<pasted_content id="a">one</pasted_content id="b">two</pasted_content id="a">',
      ),
    ).toEqual([
      {
        kind: 'pasted',
        id: 'a',
        text: 'one</pasted_content id="b">two',
        lines: 1,
      },
    ]);
    expect(
      parseMarkup('<pasted_content id="a">one</pasted_content id="b">'),
    ).toEqual([{ kind: 'pasted', id: 'a', text: 'one', lines: 1 }]);
  });
  it('handles multiple commands, stray brackets and unknown closing tags literally', () => {
    expect(
      parseMarkup(
        'a < b\n<command-name>one</command-name><command-args>x</command-args><command-name>/two</command-name><command-args>y</command-args>',
      ),
    ).toEqual([
      { kind: 'text', text: 'a < b' },
      { kind: 'command', name: '/one', args: 'x' },
      { kind: 'command', name: '/two', args: 'y' },
    ]);
    expect(parseMarkup('</command-name>')).toEqual([
      { kind: 'text', text: '</command-name>' },
    ]);
  });
  it('keeps unclosed prose tags literal in parsing, outlines and search', () => {
    for (const text of [
      'The <command-name> tag is used for slash commands',
      'Please explain <system-reminder> usage; remaining prose',
    ]) {
      const prompt = message(text);
      expect(parseMarkup(text)).toEqual([{ kind: 'text', text }]);
      expect(outlineEntries([prompt]).map((entry) => entry.label)).toEqual([
        text,
      ]);
      expect(searchableText(prompt)).toBe(text);
    }
  });
  it('preserves indentation at the start of text segments', () => {
    expect(parseMarkup('    indented code\n    more')).toEqual([
      { kind: 'text', text: '    indented code\n    more' },
    ]);
  });
  it('strips CSI and OSC ANSI escapes', () => {
    expect(stripAnsi('\u001b]0;title\u0007\u001b[?25hhello\u001b[0m')).toBe(
      'hello',
    );
  });
  it('classifies visible kinds, preserves assistant text and memoizes objects', () => {
    const prompt = message('hello');
    expect(classifyMessage(prompt).kind).toBe('prompt');
    expect(classifyMessage(prompt)).toBe(classifyMessage(prompt));
    expect(
      classifyMessage(message('<command-name>model</command-name>')).kind,
    ).toBe('command');
    expect(
      classifyMessage(
        message('<local-command-stdout>ok</local-command-stdout>'),
      ).kind,
    ).toBe('local-output');
    expect(
      classifyMessage(message('<task-notification>ok</task-notification>'))
        .kind,
    ).toBe('task-notification');
    expect(classifyMessage(message('recap', { role: 'system' })).kind).toBe(
      'note',
    );
    expect(classifyMessage(message('', { role: 'system' })).segments).toEqual(
      [],
    );
    expect(classifyMessage(message('meta', { isMeta: true })).kind).toBe(
      'other',
    );
    expect(
      classifyMessage(message('sidechain', { isSidechain: true })).kind,
    ).toBe('other');
    const literal = '<command-name>model</command-name>';
    expect(classifyMessage(message(literal, { role: 'assistant' }))).toEqual({
      kind: 'other',
      segments: [{ kind: 'text', text: literal }],
    });
  });
  it('classifies only assistant text made entirely of harness notices', () => {
    const reminder =
      '<system-reminder>Background command bu2p2ejlu completed (exit 0).</system-reminder>';
    const notice =
      '<task-notification><status>completed</status><summary>Done</summary></task-notification>';
    expect(parseAssistantNotices(`${reminder}\n${notice}`)).toEqual([
      {
        kind: 'note',
        text: 'Background command bu2p2ejlu completed (exit 0).',
      },
      { kind: 'task', status: 'completed', summary: 'Done' },
    ]);
    expect(classifyMessage(message(reminder, { role: 'assistant' })).kind).toBe(
      'note',
    );
    expect(
      classifyMessage(
        message(`The tag <system-reminder>quoted</system-reminder> is literal.`, {
          role: 'assistant',
        }),
      ),
    ).toMatchObject({ kind: 'other' });
  });
  it('classifies an image-only user message as a prompt and turn boundary', () => {
    const image = message('', { uuid: 'image', blocks: [{ type: 'image' }] });
    expect(classifyMessage(image).kind).toBe('prompt');
    expect(
      buildTurns([
        message('before', { uuid: 'before' }),
        image,
        message('after', { uuid: 'after' }),
      ]).turns.map((turn) => turn.startId),
    ).toEqual(['before', 'image', 'after']);
  });
  it('searches displayed commands and builds typed outline labels', () => {
    const command = message(
      '<command-name>model</command-name><command-args>opus</command-args>',
    );
    expect(searchableText(command)).toBe('/model opus');
    expect(searchableText(command)).not.toContain('command-name');
    const entries = outlineEntries([
      command,
      message('<local-command-stdout>ok</local-command-stdout>'),
      message('<task-notification>ok</task-notification>'),
      message('hidden', { isMeta: true }),
      message('\nFirst line\nSecond'),
      message('<pasted_content>a\nb</pasted_content>'),
      message('note', { role: 'system' }),
    ]);
    expect(entries.map(({ label, kind }) => ({ label, kind }))).toEqual([
      { label: '/model opus', kind: 'command' },
      { label: 'First line', kind: 'prompt' },
      { label: 'Pasted text (2 lines)', kind: 'prompt' },
    ]);
  });
  it('uses question and plan text for tool outline labels', () => {
    const toolMessage = (uuid: string, name: string, input: unknown) =>
      message('', {
        uuid,
        role: 'assistant',
        blocks: [{ type: 'tool_use', id: uuid, name, input }],
      });
    const entries = outlineEntries([
      toolMessage('question', 'AskUserQuestion', {
        questions: [{ question: 'Which option?' }, { question: 'Second?' }],
      }),
      toolMessage('plan', 'ExitPlanMode', {
        plan: '\n  First step\nSecond step',
      }),
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      'Which option? (+1 more)',
      'First step',
    ]);
    expect(entries.every((entry) => entry.label.length <= 120)).toBe(true);
    expect(entries.map((entry) => entry.label).join(' ')).not.toContain('{');
  });
});

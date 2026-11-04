import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@c9view/api';
import { Conversation } from '../Conversation.js';
import { PastedText } from './PastedText.js';
import { estimateRow, estimateTool } from './estimate.js';
import { duration } from './time.js';

const usage = {
  input: 900,
  output: 320,
  cacheRead: 23100,
  cacheCreation: 0,
  thinking: 0,
};
function message(
  uuid: string,
  role: Message['role'],
  text: string,
  extra: Partial<Message> = {},
): Message {
  return {
    uuid,
    role,
    timestamp: '2026-01-01T10:00:00Z',
    model: role === 'assistant' ? 'claude-opus-4-1' : null,
    isMeta: false,
    isSidechain: false,
    usage: null,
    blocks: [{ type: 'text', text }],
    ...extra,
  };
}
afterEach(cleanup);
describe('chat messages', () => {
  it('renders a prompt bubble and a semantic time', () => {
    const { container } = render(
      <Conversation messages={[message('p', 'user', 'Please fix it')]} />,
    );
    expect(container.querySelector('.bubble')).toHaveTextContent(
      'Please fix it',
    );
    expect(screen.getByText(/You ·/)).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-01-01T10:00:00Z',
    );
  });
  it('renders standalone assistant harness notices as muted notes and preserves prose', () => {
    const reminder =
      '<system-reminder>Background command bu2p2ejlu completed (exit 0).</system-reminder>';
    const { container, rerender } = render(
      <Conversation messages={[message('notice', 'assistant', reminder)]} />,
    );
    const note = screen.getByText(
      'Background command bu2p2ejlu completed (exit 0).',
    );
    expect(note).toHaveTextContent(
      'Background command bu2p2ejlu completed (exit 0).',
    );
    expect(note.closest('.text-muted')).toBeInTheDocument();
    expect(container.querySelector('p')).toBeNull();
    rerender(
      <Conversation
        messages={[
          message(
            'quoted',
            'assistant',
            'Please print <system-reminder>this exact tag</system-reminder> in the report.',
          ),
        ]}
      />,
    );
    expect(container.querySelector('article > .text-muted')).toBeNull();
    expect(container.textContent).toContain('<system-reminder>');
  });
  it('renders standalone assistant task notifications as muted notices', () => {
    render(
      <Conversation
        messages={[
          message(
            'notice',
            'assistant',
            '<task-notification><status>completed</status><summary>Build finished</summary></task-notification>',
          ),
        ]}
      />,
    );
    const summary = screen.getByText('Build finished');
    expect(summary.closest('.text-muted')).toBeInTheDocument();
  });
  it('toggles pasted text inside a pasted-only bubble', () => {
    render(
      <Conversation
        messages={[
          message(
            'p',
            'user',
            '<pasted_content>first\nsecond</pasted_content>',
          ),
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Pasted text 2 lines' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('first second')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById(button.getAttribute('aria-controls')!),
    ).toHaveTextContent('first second');
  });
  it('reveals pasted text on a search jump and lets the user close it afterwards', () => {
    const { rerender } = render(<PastedText text="Needle" lines={1} />);
    const toggle = screen.getByRole('button', { name: 'Pasted text 1 lines' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    rerender(<PastedText text="Needle" lines={1} reveal />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    rerender(<PastedText text="Needle" lines={1} reveal />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
  it('shows repeated thinking usage once per response and only on the first thinking block', () => {
    const thinking = (uuid: string, tokens = 123) =>
      message(uuid, 'assistant', '', {
        blocks: [
          { type: 'thinking', text: 'First thought' },
          { type: 'thinking', text: 'Another thought' },
        ],
        usage: { ...usage, thinking: tokens },
      });
    const first = [thinking('a'), thinking('b'), thinking('c')];
    const { rerender } = render(<Conversation messages={first} />);
    expect(screen.getAllByText('· 123 tokens')).toHaveLength(1);
    rerender(
      <Conversation
        messages={[
          ...first,
          message('result', 'user', '', {
            blocks: [
              {
                type: 'tool_result',
                toolUseId: 't',
                text: 'ok',
                isError: false,
              },
            ],
          }),
          thinking('next', 456),
        ]}
      />,
    );
    expect(screen.getAllByText('· 123 tokens')).toHaveLength(1);
    expect(screen.getAllByText('· 456 tokens')).toHaveLength(1);
  });
  it('renders command chips and collapsible plain stdout', () => {
    const { container } = render(
      <Conversation
        messages={[
          message(
            'c',
            'user',
            '<command-name>/model</command-name><command-args>opus</command-args>',
          ),
          message(
            'o',
            'user',
            '<local-command-stdout>first\nsecond</local-command-stdout>',
          ),
        ]}
      />,
    );
    expect(screen.getByText('/model')).toBeInTheDocument();
    expect(screen.getByText('opus')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('<command-name>');
    const button = screen.getByRole('button', {
      name: 'Show output (2 lines)',
    });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('pre')).toHaveTextContent('first second');
  });
  it('renders a failed task as a notice outside a bubble', () => {
    const { container } = render(
      <Conversation
        messages={[
          message(
            'n',
            'user',
            '<task-notification><status>failed</status><summary>Tests failed</summary></task-notification>',
          ),
        ]}
      />,
    );
    expect(screen.getByText('Tests failed').parentElement).toHaveClass(
      'text-danger',
    );
    expect(container.querySelector('.bubble')).toBeNull();
  });
  it('keeps one assistant header across thinking, tool, result and text', () => {
    render(
      <Conversation
        messages={[
          message('p', 'user', 'Start'),
          message('t', 'assistant', '', {
            timestamp: '2026-01-01T10:00:05Z',
            blocks: [{ type: 'thinking', text: '' }],
          }),
          message('tool', 'assistant', '', {
            blocks: [
              {
                type: 'tool_use',
                name: 'Bash',
                id: 'b',
                input: { command: 'echo yes' },
              },
            ],
          }),
          message('result', 'user', '', {
            blocks: [
              {
                type: 'tool_result',
                toolUseId: 'b',
                text: 'yes',
                isError: false,
              },
            ],
          }),
          message('a', 'assistant', 'Finished'),
        ]}
      />,
    );
    expect(screen.getAllByText('Claude', { exact: true })).toHaveLength(1);
    expect(screen.getByText('Thought for 5s')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Thought for/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Finished').closest('article')).toHaveAttribute(
      'id',
      'm-a',
    );
  });
  it('keeps group row identity when a leading hidden system message is revealed', () => {
    const leading = message('meta', 'system', '', {
      isMeta: true,
      blocks: [{ type: 'thinking', text: 'Internal' }],
    });
    const tools = [1, 2].map((n) =>
      message(`tool${n}`, 'assistant', '', {
        blocks: [{ type: 'tool_use', id: `t${n}`, name: 'Read', input: {} }],
      }),
    );
    const { container } = render(
      <Conversation
        messages={[leading, ...tools, message('answer', 'assistant', 'Done')]}
      />,
    );
    const row = container.querySelector('[data-message-row="meta"]');
    expect(row).not.toBeNull();
    expect(screen.getAllByText('Claude', { exact: true })).toHaveLength(1);
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Show system messages' }),
    );
    expect(container.querySelector('[data-message-row="meta"]')).toBe(row);
    expect(screen.getAllByText('Claude', { exact: true })).toHaveLength(1);
  });
  it('starts a new header when the model changes', () => {
    render(
      <Conversation
        messages={[
          message('a', 'assistant', 'First'),
          message('b', 'assistant', 'Second', { model: 'claude-sonnet-4-5' }),
        ]}
      />,
    );
    expect(screen.getAllByText('Claude', { exact: true })).toHaveLength(2);
  });
  it('expands nonempty thinking and renders assistant markup literally', () => {
    render(
      <Conversation
        messages={[
          message('a', 'assistant', 'Use <command-name> literally', {
            blocks: [
              { type: 'thinking', text: 'Consider this' },
              { type: 'text', text: 'Use <command-name> literally' },
            ],
          }),
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Thinking' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(screen.getByText('Consider this')).toBeInTheDocument();
    expect(
      screen.getByText('Use <command-name> literally'),
    ).toBeInTheDocument();
  });
  it('preserves literal angle brackets inside code', () => {
    render(
      <Conversation
        messages={[
          message(
            'code',
            'assistant',
            'Use `<div>` and\n\n```html\n<span>hello</span>\n```',
          ),
        ]}
      />,
    );
    expect(screen.getByText('<div>')).toBeInTheDocument();
    expect(screen.getByText('<span>hello</span>')).toBeInTheDocument();
  });
  it('places completed turn separators before prompts and in the final footer only when complete', () => {
    const messages = [
      message('p', 'user', 'First prompt'),
      message('a', 'assistant', 'First answer', {
        usage,
        timestamp: '2026-01-01T10:00:35Z',
      }),
      message('p2', 'user', 'Next prompt'),
      message('a2', 'assistant', 'Last answer', { usage }),
    ];
    const { container, rerender } = render(
      <Conversation messages={messages} />,
    );
    const separator = screen.getByRole('separator');
    expect(separator).toHaveAttribute(
      'aria-label',
      expect.stringContaining(
        'Output 320 tokens, input 24,000 tokens, cache read 23,100 tokens, 96 percent cached.',
      ),
    );
    const row = container.querySelector('[data-message-row="p2"]')!;
    expect(within(row as HTMLElement).getByRole('separator')).toBe(separator);
    expect(row.firstElementChild).toBe(separator);
    rerender(<Conversation messages={messages} trailing />);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });
});
describe('row estimates and time', () => {
  it('estimates every chat shape and divider space', () => {
    expect(
      estimateRow([
        message('c', 'user', '<command-name>/model</command-name>'),
      ]),
    ).toBe(56);
    expect(
      estimateRow([
        message('o', 'user', '<local-command-stdout>x</local-command-stdout>'),
      ]),
    ).toBe(56);
    expect(
      estimateRow([
        message('n', 'user', '<task-notification></task-notification>'),
      ]),
    ).toBe(56);
    expect(estimateRow([message('p', 'user', 'Hi')])).toBe(96);
    expect(
      estimateRow([
        message('p', 'user', '<pasted_content>Hi</pasted_content>'),
      ]),
    ).toBe(140);
    expect(estimateRow([message('a', 'assistant', 'Hello')], true)).toBe(172);
    expect(
      estimateRow([
        message('a', 'assistant', '', {
          blocks: [{ type: 'thinking', text: '' }],
        }),
      ]),
    ).toBe(120);
    const tools = [1, 2].map((n) =>
      message(String(n), 'assistant', '', {
        blocks: [{ type: 'tool_use', id: String(n), name: 'Read', input: {} }],
      }),
    );
    expect(estimateRow(tools)).toBe(62);
    expect(
      estimateRow(tools, false, { compact: true, startsAssistant: true }),
    ).toBe(114);
    expect(estimateRow(tools, false, { startsAssistant: true })).toBe(104);
    expect(estimateRow([tools[0]!], false, { variant: 'row' })).toBe(41);
  });
  it('estimates open edits, Todos, Bash, questions and inline text', () => {
    const edit = {
      type: 'tool_use' as const,
      id: 'edit',
      name: 'Edit',
      input: {},
      change: {
        filePath: '/project/a.ts',
        kind: 'update' as const,
        additions: 1,
        deletions: 1,
        truncated: false,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ['-old', '+new'],
          },
        ],
      },
    };
    expect(estimateTool(edit, 'card')).toBe(124);
    expect(estimateTool(edit, 'row', false, true)).toBe(156);
    expect(
      estimateTool(
        { type: 'tool_use', id: 'missing', name: 'Edit', input: {} },
        'card',
      ),
    ).toBe(72);
    const todo = {
      type: 'tool_use' as const,
      id: 'todos',
      name: 'TodoWrite',
      input: { todos: [{}, {}, {}] },
    };
    expect(estimateTool(todo, 'card')).toBe(132);
    expect(estimateTool(todo, 'row')).toBe(41);
    const bash = {
      type: 'tool_use' as const,
      id: 'bash',
      name: 'Bash',
      input: { command: 'echo yes' },
    };
    expect(estimateTool(bash, 'card')).toBe(224);
    expect(estimateTool(bash, 'card', true)).toBe(84);
    expect(estimateTool(bash, 'row')).toBe(41);
    expect(
      estimateTool(
        {
          ...bash,
          name: 'AskUserQuestion',
          input: { questions: [{ options: [{}, {}, {}] }] },
        },
        'card',
      ),
    ).toBe(196);
    expect(estimateTool({ ...bash, name: 'EnterPlanMode' }, 'card')).toBe(240);
    expect(
      estimateRow([
        message('interaction', 'assistant', '', {
          blocks: [bash, { ...bash, id: 'plan', name: 'EnterPlanMode' }],
        }),
      ]),
    ).toBe(464);
    expect(
      estimateRow([
        message('edit', 'assistant', '', {
          blocks: [edit, { type: 'text', text: 'Changed' }],
        }),
      ]),
    ).toBe(264);
    expect(
      estimateRow(
        [
          message('think', 'assistant', '', {
            blocks: [{ type: 'thinking', text: '' }],
          }),
        ],
        false,
        { variant: 'row' },
      ),
    ).toBe(42);
  });
  it('formats durations', () => {
    expect(duration(4000)).toBe('4s');
    expect(duration(72000)).toBe('1m 12s');
  });
});

it.each([
  [
    '<system-reminder>Background command completed.</system-reminder>',
    'Background command completed.',
  ],
  [
    '<task-notification><status>completed</status><summary>Build finished</summary></task-notification>',
    'Build finished',
  ],
])(
  'keeps assistant headers and tool cards beside notice-only text: %s',
  (text, label) => {
    const mixed = message('mixed', 'assistant', text);
    mixed.blocks.push({
      type: 'tool_use',
      id: 'notice-tool',
      name: 'Read',
      input: { file_path: 'demo.ts' },
    });
    const { container } = render(<Conversation messages={[mixed]} />);
    expect(screen.getByText(label).closest('.text-muted')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(
      screen
        .getByText(label)
        .compareDocumentPosition(screen.getByText('Claude')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const card = container.querySelector('#tool-notice-tool');
    expect(card).toHaveClass('tool-card');
    expect(card?.closest('.text-muted')).toBeNull();
    expect(container.querySelector('article')).not.toHaveTextContent(
      '<system-reminder>',
    );
  },
);

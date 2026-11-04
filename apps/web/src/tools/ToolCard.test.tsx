import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InlineChange } from '@c9view/api';
import { Result, ToolCard, relativePath, type ToolUse } from './ToolCard.js';
vi.mock('../diff/highlight.js', () => ({
  CodeLine: ({ text }: { text: string }) => <code>{text}</code>,
  languageFor: () => 'text',
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
const change: InlineChange = {
  filePath: '/workspace/demo/test.ts',
  kind: 'update',
  additions: 1,
  deletions: 1,
  truncated: false,
  hunks: [
    {
      oldStart: 10,
      oldLines: 1,
      newStart: 10,
      newLines: 1,
      lines: ['-previous', '+replacement'],
    },
  ],
};
function tool(name: string, input: unknown, change?: InlineChange): ToolUse {
  return {
    type: 'tool_use',
    id: 'call-1',
    name,
    input,
    ...(change ? { change } : {}),
  };
}
describe('tool cards', () => {
  it('shows Bash description and collapses commands beyond five lines', () => {
    render(
      <ToolCard
        block={tool('Bash', {
          description: 'Inspect fixtures',
          command: 'one\ntwo\nthree\nfour\nfive\nsix',
        })}
      />,
    );
    expect(screen.getByText('Inspect fixtures')).toBeInTheDocument();
    expect(screen.getByText(/one/)).not.toHaveTextContent('six');
    fireEvent.click(screen.getByRole('button', { name: 'Show command' }));
    expect(screen.getByText(/one/)).toHaveTextContent('six');
  });
  it('renders an Edit inline diff with project link at the correct line', () => {
    const openChange = vi.fn();
    render(
      <ToolCard
        block={tool('Edit', { file_path: change.filePath }, change)}
        context={{ projectId: 'p', projectPath: '/workspace/demo', openChange }}
      />,
    );
    expect(screen.getByLabelText('Removed line 10')).toHaveTextContent(
      'previous',
    );
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/projects/p?tab=files&path=test.ts&line=10',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open in Files changed' }),
    );
    expect(openChange).toHaveBeenCalledWith('call-1');
  });
  it.each(['create', 'update'] as const)(
    'uses the API diff for Write %s',
    (kind) => {
      const patch: InlineChange =
        kind === 'create'
          ? {
              ...change,
              kind,
              deletions: 0,
              hunks: [
                {
                  oldStart: 0,
                  oldLines: 0,
                  newStart: 1,
                  newLines: 1,
                  lines: ['+created'],
                },
              ],
            }
          : change;
      render(
        <ToolCard
          block={tool(
            'Write',
            { file_path: patch.filePath, content: 'ignored input' },
            patch,
          )}
        />,
      );
      if (kind === 'create')
        expect(screen.getByText('New file')).toBeInTheDocument();
      else expect(screen.queryByText('New file')).not.toBeInTheDocument();
      if (kind === 'update')
        expect(screen.getByText('previous')).toBeInTheDocument();
      else expect(screen.getByText('created')).toBeInTheDocument();
      expect(screen.queryByText('ignored input')).not.toBeInTheDocument();
    },
  );
  it('keeps unknown tool JSON fallback and outside paths as plain text', () => {
    render(<ToolCard block={tool('Custom', { answer: 42 })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByText('Tool input')).toBeInTheDocument();
    expect(screen.getByText(/"answer": 42/)).toBeInTheDocument();
    expect(
      relativePath('/workspace/demo-other/file', '/workspace/demo'),
    ).toBeUndefined();
    expect(relativePath('../secret', '/workspace/demo')).toBeUndefined();
  });
  it('reveals all returned output without a character cap', () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `line ${i} ${'x'.repeat(200)}`,
    ).join('\n');
    const { container } = render(
      <Result
        result={{
          type: 'tool_result',
          toolUseId: 'call-1',
          isError: false,
          text,
        }}
      />,
    );
    expect(container.querySelector('pre')?.textContent).not.toContain(
      'line 39',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Show all (40 lines)' }),
    );
    expect(container.querySelector('pre')?.textContent).toBe(text);
  });
});

it('shows Bash timing and strips the exit marker from output', () => {
  const { container } = render(
    <ToolCard
      block={tool('Bash', { command: 'pwd' })}
      timing={{
        callAt: '2026-01-01T00:00:00Z',
        resultAt: '2026-01-01T00:00:01Z',
      }}
      results={[
        {
          type: 'tool_result',
          toolUseId: 'call-1',
          isError: false,
          text: 'Exit code 0\n/workspace',
        },
      ]}
    />,
  );
  expect(screen.getByText('exit 0 · 1s')).toBeInTheDocument();
  expect(container.querySelectorAll('pre')[1]).not.toHaveTextContent(
    'Exit code',
  );
});
it('opens a collapsed row and forces it open when revealed', () => {
  const block = tool('Read', { file_path: 'file.ts' });
  const results = [
    {
      type: 'tool_result' as const,
      toolUseId: 'call-1',
      isError: false,
      text: '1\tcontent',
    },
  ];
  const { rerender } = render(
    <ToolCard block={block} results={results} variant="row" />,
  );
  const button = screen.getByRole('button', { name: 'Read file.ts' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(button);
  rerender(
    <ToolCard
      block={block}
      results={results}
      variant="row"
      context={{ revealToolId: 'call-1' }}
    />,
  );
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('1 content')).toBeInTheDocument();
});
it('shows todo counts and in-progress status', () => {
  render(
    <ToolCard
      block={tool('TodoWrite', {
        todos: [
          { content: 'One', status: 'completed' },
          { content: 'Two', status: 'in_progress' },
          { content: 'Three', status: 'pending' },
        ],
      })}
    />,
  );
  expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
  expect(screen.getByText('in progress')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Todos' })).toBeInTheDocument();
});
it('shows read-only question options and marks an answered option', () => {
  const block = tool('AskUserQuestion', {
    questions: [
      {
        question: 'Deploy?',
        options: [{ label: 'Deploy on web' }, { label: 'Wait' }],
      },
    ],
  });
  const { rerender } = render(<ToolCard block={block} />);
  expect(
    screen.getByText('Question · waiting for your answer'),
  ).toBeInTheDocument();
  expect(screen.getByText('Deploy on web').tagName).toBe('SPAN');
  rerender(
    <ToolCard
      block={block}
      results={[
        {
          type: 'tool_result',
          toolUseId: 'call-1',
          isError: false,
          text: 'The user answered: "Deploy?"="Deploy on web"',
        },
      ]}
    />,
  );
  expect(screen.getByText('Question · answered')).toBeInTheDocument();
  expect(screen.getByText('selected')).toHaveClass('sr-only');
});
it('matches question answers by exact label, including comma-separated choices', () => {
  const questions = [
    {
      question: 'Timing?',
      options: [
        { label: 'Yes' },
        { label: 'Yes, but later' },
        { label: 'No' },
        { label: 'A' },
        { label: 'B' },
      ],
    },
  ];
  const block = (answer: string) =>
    tool('AskUserQuestion', { questions, answers: { 'Timing?': answer } });
  const { rerender } = render(<ToolCard block={block('Yes, but later')} />);
  expect(
    screen.getByText('Yes, but later').closest('.rounded-lg'),
  ).toHaveTextContent('selected');
  expect(screen.getByText('Yes').closest('.rounded-lg')).not.toHaveTextContent(
    'selected',
  );
  rerender(<ToolCard block={block('Not yet')} />);
  expect(screen.getByText('No').closest('.rounded-lg')).not.toHaveTextContent(
    'selected',
  );
  rerender(<ToolCard block={block('A, B')} />);
  expect(screen.getByText('A').closest('.rounded-lg')).toHaveTextContent(
    'selected',
  );
  expect(screen.getByText('B').closest('.rounded-lg')).toHaveTextContent(
    'selected',
  );
});
it.each([
  {
    answer: 'Yes, but later, No, thanks',
    selected: ['Yes, but later', 'No, thanks'],
  },
  { answer: 'Yes, No, thanks', selected: ['Yes', 'No, thanks'] },
  { answer: 'Yes, but later', selected: ['Yes, but later'] },
  { answer: 'Yes', selected: ['Yes'] },
  { answer: 'Yes, something else', selected: ['Yes'] },
  { answer: 'A custom answer', selected: [] },
  { answer: 'A, B, custom text', selected: ['A', 'B'] },
  { answer: 'Foo, bar', selected: ['Foo'] },
  { answer: 'Other', selected: [] },
  { answer: 'Other, custom text, B', selected: ['B'] },
  { answer: 'A, B, C, custom text', selected: ['A', 'B', 'C'] },
  { answer: 'A, B', selected: ['A, B'] },
])('highlights only complete options for "$answer"', ({ answer, selected }) => {
  const labels = [
    'Yes',
    'Yes, but later',
    'No',
    'No, thanks',
    'A',
    'B',
    'C',
    'A, B',
    'Foo',
  ];
  render(
    <ToolCard
      block={tool('AskUserQuestion', {
        questions: [
          { question: 'Timing?', options: labels.map((label) => ({ label })) },
        ],
        answers: { 'Timing?': answer },
      })}
    />,
  );
  for (const label of labels) {
    const option = screen.getByText(label).closest('.rounded-lg');
    if (selected.includes(label)) expect(option).toHaveTextContent('selected');
    else expect(option).not.toHaveTextContent('selected');
  }
});
it('includes the status badge in the tool row accessible name', () => {
  render(
    <ToolCard
      block={tool('Bash', { command: 'true' })}
      results={[
        {
          type: 'tool_result',
          toolUseId: 'call-1',
          isError: false,
          text: 'ok',
        },
      ]}
      variant="row"
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Bash true' }),
  ).toHaveAccessibleDescription('exit 0');
});
it('opens a subagent while its Agent row remains closed', () => {
  const openSubagent = vi.fn();
  render(
    <ToolCard
      block={tool('Agent', { description: 'Investigate', prompt: 'Details' })}
      variant="row"
      context={{
        subagents: [
          {
            agentId: 'agent-123',
            description: 'Investigation',
            parentToolUseId: 'call-1',
          },
        ],
        openSubagent,
      }}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Agent Investigate' }),
  ).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(
    screen.getByRole('button', { name: /Subagent: Investigation/ }),
  );
  expect(openSubagent).toHaveBeenCalledWith('agent-123');
});
it('splits an MCP display name into server and tool', () => {
  render(<ToolCard block={tool('mcp__github__search', { query: 'needle' })} />);
  expect(screen.getByText('github')).toBeInTheDocument();
  expect(screen.getByText('search')).toBeInTheDocument();
});

it('tolerates malformed todo and question arrays', () => {
  const { rerender } = render(
    <ToolCard
      block={tool('TodoWrite', {
        todos: [
          null,
          3,
          {},
          { content: { nested: true }, status: { unexpected: true } },
        ],
      })}
    />,
  );
  expect(screen.getByRole('list', { name: 'Todos' })).toBeInTheDocument();
  expect(screen.getByText('0 of 2 done')).toBeInTheDocument();
  rerender(
    <ToolCard
      block={tool('AskUserQuestion', {
        questions: [
          null,
          3,
          { question: { bad: true }, options: 'invalid' },
          {
            question: 'Valid question',
            options: [
              null,
              2,
              { label: { bad: true } },
              { label: 'Valid option' },
            ],
          },
        ],
      })}
    />,
  );
  expect(screen.getByText('Valid question')).toBeInTheDocument();
  expect(screen.getByText('Valid option')).toBeInTheDocument();
});
it('shows compact Bash previews only for standalone cards', () => {
  const block = tool('Bash', { command: 'pwd' });
  const results = [
    {
      type: 'tool_result' as const,
      toolUseId: 'call-1',
      isError: false,
      text: 'last output',
    },
  ];
  const { rerender } = render(
    <ToolCard
      block={block}
      results={results}
      variant="row"
      context={{ compact: true }}
    />,
  );
  expect(screen.queryByText('last output')).not.toBeInTheDocument();
  rerender(
    <ToolCard
      block={block}
      results={results}
      variant="card"
      context={{ compact: true }}
    />,
  );
  expect(screen.getByText('last output')).toBeInTheDocument();
});

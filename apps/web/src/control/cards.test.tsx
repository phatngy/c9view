import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  PermissionRequest,
  QuestionRequest,
  TrustSummary,
} from '@c9view/api';
import { afterEach, expect, it, vi } from 'vitest';
import {
  BypassBadge,
  DrivenBadge,
  PermissionCard,
  QuestionCard,
  TrustCard,
} from './cards.js';

afterEach(cleanup);
const permission: PermissionRequest = {
  kind: 'permission',
  requestId: 'permission-1',
  runId: 'run-1',
  sessionId: 'session-1',
  createdAt: '2026-01-01T12:00:00Z',
  expiresAt: '2026-01-01T12:30:00Z',
  toolName: 'Bash',
  summary: 'printf [REDACTED]',
};
const question: QuestionRequest = {
  kind: 'question',
  requestId: 'question-1',
  runId: 'run-1',
  sessionId: 'session-1',
  createdAt: permission.createdAt,
  expiresAt: permission.expiresAt,
  questions: [
    {
      header: 'Approach',
      question: 'Which approach?',
      multiSelect: false,
      options: [
        { label: 'Quick', description: 'Use a small patch' },
        { label: 'Thorough', description: 'Review all callers' },
      ],
    },
  ],
};
const trust: TrustSummary = {
  path: '/workspace/example',
  fingerprint: 'summary-1',
  hooks: ['echo [REDACTED]'],
  mcpServers: ['fixture-server'],
  allowRules: ['Read'],
  plugins: ['fixture-plugin'],
  hasClaudeMd: true,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// jsdom does not perform browser key default actions. Dispatch the zero-detail
// click browsers generate for native keyboard activation, never a pointer event.
function activate(element: HTMLElement, key = 'Enter') {
  element.focus();
  expect(element).toHaveFocus();
  fireEvent.keyDown(element, { key });
  fireEvent.keyUp(element, { key });
  fireEvent.click(element, { detail: 0 });
}

it('names the permission card and renders the redacted tool summary and expiry', () => {
  render(<PermissionCard request={permission} onDecide={vi.fn()} />);
  expect(
    screen.getByRole('region', { name: 'Permission for Bash' }),
  ).toBeInTheDocument();
  expect(screen.getByText(permission.summary)).toBeInTheDocument();
  expect(
    screen.getByText(new Date(permission.expiresAt).toLocaleString()),
  ).toHaveAttribute('dateTime', permission.expiresAt);
});

it.each([
  ['Allow', { decision: 'allow' }],
  ['Deny', { decision: 'deny' }],
] as const)(
  'supports keyboard activation of %s with the exact decision',
  async (label, decision) => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<PermissionCard request={permission} onDecide={onDecide} />);
    activate(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(onDecide).toHaveBeenCalledExactlyOnceWith(decision),
    );
  },
);

it('supports a keyboard denial with a message and preserves the exact text', async () => {
  const onDecide = vi.fn().mockResolvedValue(undefined);
  render(<PermissionCard request={permission} onDecide={onDecide} />);
  const disclose = screen.getByRole('button', { name: 'Deny with a message' });
  activate(disclose, ' ');
  expect(disclose).toHaveAttribute('aria-expanded', 'true');
  const input = screen.getByRole('textbox', { name: 'Message to Claude' });
  input.focus();
  expect(input).toHaveFocus();
  fireEvent.change(input, {
    target: { value: 'Please use the fixture instead.' },
  });
  expect(screen.getByText('31 / 2,000 characters')).toBeInTheDocument();
  activate(screen.getByRole('button', { name: 'Send denial' }));
  await waitFor(() =>
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({
      decision: 'deny',
      message: 'Please use the fixture instead.',
    }),
  );
});

it('caps the denial message at 2,000 characters', () => {
  render(<PermissionCard request={permission} onDecide={vi.fn()} />);
  activate(screen.getByRole('button', { name: 'Deny with a message' }));
  const input = screen.getByRole('textbox');
  expect(input).toHaveAttribute('maxLength', '2000');
  fireEvent.change(input, { target: { value: 'x'.repeat(2001) } });
  expect(input).toHaveValue('x'.repeat(2000));
  expect(screen.getByText('2000 / 2,000 characters')).toBeInTheDocument();
});

it('prevents permission decisions during and after a successful request', async () => {
  const pending = deferred();
  const onDecide = vi.fn(() => pending.promise);
  render(<PermissionCard request={permission} onDecide={onDecide} />);
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(onDecide).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(screen.getByRole('status')).toHaveTextContent('Decision sent.');
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(onDecide).toHaveBeenCalledTimes(1);
});

it('shows a permission error and allows a retry with the retained message', async () => {
  const onDecide = vi
    .fn()
    .mockRejectedValueOnce(new Error('The machine is unavailable.'))
    .mockResolvedValue(undefined);
  render(<PermissionCard request={permission} onDecide={onDecide} />);
  activate(screen.getByRole('button', { name: 'Deny with a message' }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Keep this text' },
  });
  activate(screen.getByRole('button', { name: 'Send denial' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The machine is unavailable.',
  );
  expect(screen.getByRole('textbox')).toHaveValue('Keep this text');
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  activate(screen.getByRole('button', { name: 'Send denial' }));
  await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(2));
});

it('names the question card and labels its options with descriptions', () => {
  render(<QuestionCard request={question} onDecide={vi.fn()} />);
  expect(
    screen.getByRole('region', { name: 'Questions: Which approach?' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('group', { name: /Approach.*Which approach/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('radio', { name: /Quick/ }),
  ).toHaveAccessibleDescription('Use a small patch');
  expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
});

it('submits a single answer using a native radio from the keyboard', async () => {
  const onDecide = vi.fn().mockResolvedValue(undefined);
  render(<QuestionCard request={question} onDecide={onDecide} />);
  activate(screen.getByRole('radio', { name: /Thorough/ }), ' ');
  expect(screen.getByRole('radio', { name: /Thorough/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Quick/ })).not.toBeChecked();
  activate(screen.getByRole('button', { name: 'Submit answers' }));
  await waitFor(() =>
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({
      answers: { 'Which approach?': 'Thorough' },
    }),
  );
});

it('submits multiple answers as labels in option order from native checkboxes', async () => {
  const onDecide = vi.fn().mockResolvedValue(undefined);
  const multi = {
    ...question,
    questions: [{ ...question.questions[0]!, multiSelect: true }],
  };
  render(<QuestionCard request={multi} onDecide={onDecide} />);
  activate(screen.getByRole('checkbox', { name: /Thorough/ }), ' ');
  activate(screen.getByRole('checkbox', { name: /Quick/ }), ' ');
  activate(screen.getByRole('button', { name: 'Submit answers' }));
  await waitFor(() =>
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({
      answers: { 'Which approach?': ['Quick', 'Thorough'] },
    }),
  );
});

it.each([false, true])(
  'submits Other text exactly (multiSelect=%s), replacing option selections',
  async (multiSelect) => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <QuestionCard
        request={{
          ...question,
          questions: [{ ...question.questions[0]!, multiSelect }],
        }}
        onDecide={onDecide}
      />,
    );
    const role = multiSelect ? 'checkbox' : 'radio';
    activate(screen.getByRole(role, { name: /Quick/ }), ' ');
    activate(screen.getByRole(role, { name: 'Other' }), ' ');
    expect(screen.getByRole(role, { name: /Quick/ })).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Submit answers' }),
    ).toBeDisabled();
    const input = screen.getByRole('textbox', {
      name: 'Other answer for Approach',
    });
    input.focus();
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Try a prototype  ' } });
    activate(screen.getByRole('button', { name: 'Submit answers' }));
    await waitFor(() =>
      expect(onDecide).toHaveBeenCalledExactlyOnceWith({
        answers: { 'Which approach?': '  Try a prototype  ' },
      }),
    );
  },
);

it('requires nonblank Other text and caps it at 2,000 characters', () => {
  render(<QuestionCard request={question} onDecide={vi.fn()} />);
  activate(screen.getByRole('radio', { name: 'Other' }), ' ');
  const input = screen.getByRole('textbox');
  expect(input).toHaveAttribute('maxLength', '2000');
  fireEvent.change(input, { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'x'.repeat(2001) } });
  expect(input).toHaveValue('x'.repeat(2000));
  expect(screen.getByText('2000 / 2,000 characters')).toBeInTheDocument();
});

it('submits each question under its own question text and requires every answer', async () => {
  const onDecide = vi.fn().mockResolvedValue(undefined);
  render(
    <QuestionCard
      request={{
        ...question,
        questions: [
          ...question.questions,
          {
            ...question.questions[0]!,
            header: 'Scope',
            question: 'Which scope?',
            multiSelect: true,
          },
        ],
      }}
      onDecide={onDecide}
    />,
  );
  const groups = screen.getAllByRole('group');
  activate(within(groups[0]!).getByRole('radio', { name: /Quick/ }), ' ');
  expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
  activate(within(groups[1]!).getByRole('checkbox', { name: /Thorough/ }), ' ');
  activate(screen.getByRole('button', { name: 'Submit answers' }));
  await waitFor(() =>
    expect(onDecide).toHaveBeenCalledExactlyOnceWith({
      answers: { 'Which approach?': 'Quick', 'Which scope?': ['Thorough'] },
    }),
  );
});

it('disables question controls and prevents double submission, including after success', async () => {
  const pending = deferred();
  const onDecide = vi.fn(() => pending.promise);
  render(<QuestionCard request={question} onDecide={onDecide} />);
  activate(screen.getByRole('radio', { name: /Quick/ }), ' ');
  const button = screen.getByRole('button', { name: 'Submit answers' });
  fireEvent.click(button);
  fireEvent.submit(button.closest('form')!);
  expect(button).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Quick/ })).toBeDisabled();
  expect(onDecide).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  fireEvent.submit(button.closest('form')!);
  expect(onDecide).toHaveBeenCalledTimes(1);
});

it('shows a question error, retains the answer and lets the user retry', async () => {
  const onDecide = vi
    .fn()
    .mockRejectedValueOnce(new Error('Please reconnect.'))
    .mockResolvedValue(undefined);
  render(<QuestionCard request={question} onDecide={onDecide} />);
  activate(screen.getByRole('radio', { name: /Quick/ }), ' ');
  activate(screen.getByRole('button', { name: 'Submit answers' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Please reconnect.',
  );
  expect(screen.getByRole('radio', { name: /Quick/ })).toBeChecked();
  activate(screen.getByRole('button', { name: 'Submit answers' }));
  await waitFor(() => expect(onDecide).toHaveBeenCalledTimes(2));
});

it('resets decision state when a different request replaces a card', async () => {
  const onDecide = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(
    <PermissionCard request={permission} onDecide={onDecide} />,
  );
  activate(screen.getByRole('button', { name: 'Allow' }));
  await screen.findByText('Decision sent.');
  rerender(
    <PermissionCard
      request={{ ...permission, requestId: 'permission-2' }}
      onDecide={onDecide}
    />,
  );
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
});

it('renders every trust summary field and the settings-changed note', () => {
  render(
    <TrustCard trust={trust} onTrust={vi.fn()} onCancel={vi.fn()} changed />,
  );
  expect(
    screen.getByRole('region', { name: `Trust folder ${trust.path}` }),
  ).toBeInTheDocument();
  for (const value of [
    trust.path,
    ...trust.hooks,
    ...trust.mcpServers,
    ...trust.allowRules,
    ...trust.plugins,
    'Present',
  ])
    expect(screen.getByText(value)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'settings changed since the last summary',
  );
});

it('renders empty trust lists and missing CLAUDE.md', () => {
  render(
    <TrustCard
      trust={{
        ...trust,
        hooks: [],
        mcpServers: [],
        allowRules: [],
        plugins: [],
        hasClaudeMd: false,
      }}
      onTrust={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getAllByText('None')).toHaveLength(4);
  expect(screen.getByText('Not present')).toBeInTheDocument();
});

it('calls onTrust once and disables both actions while pending and after success', async () => {
  const pending = deferred();
  const onTrust = vi.fn(() => pending.promise);
  const onCancel = vi.fn();
  render(<TrustCard trust={trust} onTrust={onTrust} onCancel={onCancel} />);
  activate(screen.getByRole('button', { name: 'Trust this folder' }));
  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(onTrust).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(screen.getByRole('status')).toHaveTextContent('Folder trusted.');
  expect(
    screen.getByRole('button', { name: 'Trust this folder' }),
  ).toBeDisabled();
});

it('shows trust errors, permits cancellation and resets for the new summary', async () => {
  const onTrust = vi
    .fn()
    .mockRejectedValue(new Error('The folder settings changed.'));
  const onCancel = vi.fn();
  const { rerender } = render(
    <TrustCard trust={trust} onTrust={onTrust} onCancel={onCancel} />,
  );
  activate(screen.getByRole('button', { name: 'Trust this folder' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The folder settings changed.',
  );
  expect(
    screen.getByRole('button', { name: 'Trust this folder' }),
  ).toBeEnabled();
  activate(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  rerender(
    <TrustCard
      trust={{ ...trust, fingerprint: 'summary-2', hooks: ['updated command'] }}
      onTrust={onTrust}
      onCancel={onCancel}
      changed
    />,
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('updated command')).toBeInTheDocument();
});

it.each([false, true])(
  'renders explicit Bypass and Driven badge text (compact=%s)',
  (compact) => {
    render(
      <>
        <BypassBadge compact={compact} />
        <DrivenBadge compact={compact} />
      </>,
    );
    expect(screen.getByText('Bypass')).toHaveAccessibleDescription(
      'Permissions are bypassed on this machine.',
    );
    expect(screen.getByText('Driven by c9view')).toBeInTheDocument();
  },
);

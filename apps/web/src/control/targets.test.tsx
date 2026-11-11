import { cleanup, render, screen } from '@testing-library/react';
import type {
  PermissionRequest,
  QuestionRequest,
  RunSummary,
  TrustSummary,
} from '@c9view/api';
import { afterEach, expect, it, vi } from 'vitest';
import { PermissionCard, QuestionCard, TrustCard } from './cards.js';
import { RunBar } from './RunBar.js';

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
      options: [{ label: 'Quick', description: 'Use a small patch' }],
    },
  ],
};

const trust: TrustSummary = {
  path: '/workspace/example',
  fingerprint: 'summary-1',
  hooks: [],
  mcpServers: [],
  allowRules: [],
  plugins: [],
  hasClaudeMd: false,
};

const run: RunSummary = {
  runId: 'run-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  state: 'running',
  mode: 'default',
  queued: 0,
  startedAt: '2026-01-01T12:00:00Z',
  ownedByC9view: true,
};

function expectTarget(button: HTMLElement) {
  expect(button).toHaveClass(
    'min-h-11',
    'min-w-11',
    'lg:min-h-9',
    'lg:min-w-9',
  );
}

it('keeps permission and question card small buttons at least 44px tall below lg', () => {
  render(
    <>
      <PermissionCard
        request={permission}
        onDecide={vi.fn().mockResolvedValue(undefined)}
      />
      <QuestionCard
        request={question}
        onDecide={vi.fn().mockResolvedValue(undefined)}
      />
    </>,
  );

  for (const name of [
    'Allow',
    'Deny',
    'Deny with a message',
    'Submit answers',
  ]) {
    expectTarget(screen.getByRole('button', { name }));
  }
  expect(screen.getByRole('button', { name: 'Allow' })).toHaveClass('sm:h-8');
});

it('keeps trust card buttons at least 44px tall below lg', () => {
  render(
    <TrustCard
      trust={trust}
      onTrust={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
    />,
  );

  expectTarget(screen.getByRole('button', { name: 'Trust this folder' }));
  expectTarget(screen.getByRole('button', { name: 'Cancel' }));
});

it('keeps run controls at least 44px tall below lg', () => {
  render(<RunBar run={run} onStop={vi.fn().mockResolvedValue(undefined)} />);

  expectTarget(screen.getByRole('button', { name: 'Run options' }));
});

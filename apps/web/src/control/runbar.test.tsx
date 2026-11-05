import type { RunState, RunSummary } from '@c9view/api';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunBar } from './RunBar.js';

afterEach(cleanup);
const base: RunSummary = {
  runId: 'r',
  projectId: 'p',
  sessionId: 's',
  state: 'idle',
  mode: 'default',
  queued: 0,
  startedAt: '2026-11-01',
  ownedByC9view: true,
};
function bar(
  over: Partial<RunSummary> = {},
  needsInput = false,
  stop = vi.fn(async () => {}),
) {
  const props = {
    run: { ...base, ...over },
    needsInput,
    onInterrupt: vi.fn(async () => {}),
    onStop: stop,
  };
  const view = render(<RunBar {...props} />);
  return {
    ...props,
    view,
    rerender: (next: Partial<RunSummary>, input = needsInput) =>
      view.rerender(
        <RunBar {...props} run={{ ...base, ...next }} needsInput={input} />,
      ),
  };
}

it.each<[RunState, string]>([
  ['starting', 'Starting…'],
  ['running', 'Working…'],
  ['waiting', 'Waiting for you'],
  ['idle', 'Ready'],
  ['ended', 'Ended'],
  ['failed', 'Failed'],
])('maps %s to "%s" with text alongside the dot', (state, text) => {
  bar({ state });
  expect(screen.getByText(text)).toBeVisible();
  expect(screen.getByTestId('run-dot')).toHaveAttribute('aria-hidden', 'true');
});
it('shows Waiting for you when a request is pending, and pulses only while active', () => {
  bar({ state: 'running' }, true);
  expect(screen.getByText('Waiting for you')).toBeVisible();
  expect(screen.getByTestId('run-dot')).not.toHaveClass('animate-pulse');
  cleanup();
  bar({ state: 'running' });
  expect(screen.getByTestId('run-dot')).toHaveClass(
    'animate-pulse',
    'motion-reduce:animate-none',
  );
});
it.each<[RunState, boolean]>([
  ['starting', true],
  ['running', true],
  ['waiting', false],
  ['idle', false],
  ['ended', false],
  ['failed', false],
])('Interrupt for %s is %s', (state, shown) => {
  bar({ state });
  expect(!!screen.queryByRole('button', { name: 'Interrupt' })).toBe(shown);
});
it('reaches Stop through the Run options menu and calls it', async () => {
  const { onStop } = bar({ state: 'idle' });
  const trigger = screen.getByRole('button', { name: 'Run options' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop run' }));
  await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
});
it('exposes the cost with an accessible description', () => {
  bar({ costUsd: 0.02 });
  const link = screen.getByRole('link', {
    name: 'About 0.02 dollars, API-equivalent cost',
  });
  expect(link).toHaveAttribute('href', '#api-equivalent-cost');
  expect(link).toHaveTextContent('$0.02');
});
it('announces only Waiting for you, Ended and Failed, once, and not on refetch', () => {
  const live = () =>
    screen
      .getAllByRole('status')
      .map((n) => n.textContent)
      .join('|');
  const { rerender } = bar({ state: 'idle' });
  expect(live()).toBe('');
  rerender({ state: 'running' });
  expect(live()).toBe('');
  rerender({ state: 'running', costUsd: 1 });
  expect(live()).toBe('');
  rerender({ state: 'waiting' });
  expect(live()).toBe('Waiting for you');
  rerender({ state: 'waiting', queued: 0, costUsd: 2 });
  expect(live()).toBe('Waiting for you');
  rerender({ state: 'ended' });
  expect(live()).toBe('Ended');
  rerender({ state: 'idle' });
  expect(live()).toBe('');
});
it('keeps one line on phones: badges hide first, text truncates, targets stay 44px', () => {
  bar({ state: 'running', mode: 'bypassPermissions', costUsd: 1 });
  expect(screen.getByTestId('run-badges')).toHaveClass('max-sm:hidden');
  expect(screen.getByText('Working…')).toHaveClass('truncate');
  expect(screen.getByRole('button', { name: 'Interrupt' })).toHaveClass(
    'min-h-11',
  );
  expect(screen.getByRole('button', { name: 'Run options' })).toHaveClass(
    'min-h-11',
    'min-w-11',
  );
  expect(screen.getByRole('link')).toHaveClass('min-h-11');
});

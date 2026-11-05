import type { RunState, RunSummary } from '@c9view/api';
import {
  act,
  cleanup,
  within,
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
it.each<RunState>(['starting', 'running', 'waiting', 'idle'])(
  'has no Interrupt button for %s',
  (state) => {
    bar({ state });
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();
  },
);
it('reaches Stop through the Run options menu and calls it', async () => {
  const { onStop } = bar({ state: 'idle' });
  const trigger = screen.getByRole('button', { name: 'Run options' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Stop this run?',
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
});
it('shows no cost and styles Stop with the danger token', async () => {
  bar({ costUsd: 0.02 });
  expect(screen.queryByText('$0.02')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run options' }));
  expect(await screen.findByRole('menuitem', { name: 'Stop' })).toHaveClass(
    'text-danger!',
  );
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
  rerender({ state: 'running' });
  expect(live()).toBe('');
  rerender({ state: 'waiting' });
  expect(live()).toBe('Waiting for you');
  rerender({ state: 'waiting', queued: 0 });
  expect(live()).toBe('Waiting for you');
  rerender({ state: 'ended' });
  expect(live()).toBe('Ended');
  rerender({ state: 'idle' });
  expect(live()).toBe('');
  rerender({ state: 'failed' });
  expect(live()).toBe('Failed');
});
it('hides Run options once the run has ended or failed', () => {
  for (const state of ['ended', 'failed'] as const) {
    bar({ state });
    expect(screen.queryByRole('button', { name: 'Run options' })).toBeNull();
    cleanup();
  }
});
it('keeps the full status in a title and the queued count out of truncation', () => {
  bar({ state: 'running', queued: 3 });
  expect(screen.getByText('Working…').parentElement).toHaveAttribute(
    'title',
    'Working… · 3 queued',
  );
  expect(screen.getByText('· 3 queued')).toHaveClass('shrink-0');
  expect(screen.getByText('· 3 queued')).not.toHaveClass('truncate');
});
it('opens Run options from the keyboard and selects Stop with ArrowDown and Enter', async () => {
  const { onStop } = bar({ state: 'idle' });
  const trigger = screen.getByRole('button', { name: 'Run options' });
  trigger.focus();
  expect(trigger).toHaveFocus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(trigger);
  const item = await screen.findByRole('menuitem', { name: 'Stop' });
  fireEvent.keyDown(item, { key: 'ArrowDown' });
  fireEvent.keyDown(item, { key: 'Enter' });
  fireEvent.click(item);
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Stop this run?',
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
});
it('closes the menu on Escape, returns focus to the trigger and does not stop', async () => {
  const { onStop } = bar({ state: 'idle' });
  const trigger = screen.getByRole('button', { name: 'Run options' });
  trigger.focus();
  fireEvent.click(trigger);
  const item = await screen.findByRole('menuitem', { name: 'Stop' });
  fireEvent.keyDown(item, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(onStop).not.toHaveBeenCalled();
});
it('keeps one line on phones: badges hide first, text truncates, targets stay 44px', () => {
  bar({ state: 'running', mode: 'bypassPermissions' });
  expect(screen.getByTestId('run-badges')).toHaveClass('max-sm:hidden');
  expect(screen.getByText('Working…')).toHaveClass('truncate');
  expect(screen.getByRole('button', { name: 'Run options' })).toHaveClass(
    'min-h-11',
    'min-w-11',
  );
});

const sessionStatus = (column: string) =>
  ({ column, reason: '', source: 'none', observedAt: null }) as never;
function bare(column: string, lastAt: string | null = null) {
  const view = render(
    <RunBar status={sessionStatus(column)} lastAt={lastAt} />,
  );
  return {
    view,
    rerender: (next: string, at: string | null = lastAt) =>
      view.rerender(<RunBar status={sessionStatus(next)} lastAt={at} />),
  };
}
it.each([
  ['inactive', 'Inactive'],
  ['need_input', 'Need input'],
  ['in_progress', 'In progress'],
  ['in_review', 'In review'],
])('without a run shows the session status %s as "%s"', (column, text) => {
  bare(column, '2026-11-05T11:57:00Z');
  expect(screen.getByRole('region', { name: 'Session status' })).toBeVisible();
  expect(screen.getByText(text)).toBeVisible();
  expect(screen.getByTestId('run-dot')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByTestId('run-badges')).toBeNull();
});
it('without a run has no Run options menu', () => {
  bare('in_progress');
  expect(screen.queryByRole('button', { name: 'Run options' })).toBeNull();
});
it('shows last active from a fixed clock and refreshes each minute without announcing', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  try {
    bare('inactive', '2026-11-05T11:57:00Z');
    expect(screen.getByTestId('last-active')).toHaveTextContent(
      '· last active 3m ago',
    );
    expect(screen.getByTestId('last-active')).toHaveClass('truncate');
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByTestId('last-active')).toHaveTextContent(
      '· last active 5m ago',
    );
    expect(
      screen
        .getAllByRole('status')
        .map((n) => n.textContent)
        .join(''),
    ).toBe('');
  } finally {
    vi.useRealTimers();
  }
});
it('shows No activity when the session has no timestamp', () => {
  bare('inactive', null);
  expect(screen.getByTestId('last-active')).toHaveTextContent('No activity');
});
it('shows the run state, not the session state, when a run exists', () => {
  render(
    <RunBar
      run={{ ...base, state: 'running' }}
      status={sessionStatus('inactive')}
      lastAt="2026-11-05T11:57:00Z"
      onStop={vi.fn(async () => {})}
    />,
  );
  expect(screen.getByText('Working…')).toBeVisible();
  expect(screen.queryByText('Inactive')).toBeNull();
  expect(screen.queryByTestId('last-active')).toBeNull();
  expect(screen.getByRole('button', { name: 'Run options' })).toBeVisible();
});
it('announces only a change into Need input, not on refetch', () => {
  const live = () =>
    screen
      .getAllByRole('status')
      .map((n) => n.textContent)
      .join('');
  const { rerender } = bare('inactive', '2026-11-05T11:57:00Z');
  rerender('inactive', '2026-11-05T11:58:00Z');
  expect(live()).toBe('');
  rerender('in_progress');
  expect(live()).toBe('');
  rerender('need_input');
  expect(live()).toBe('Need input');
  rerender('need_input', '2026-11-05T11:59:00Z');
  expect(live()).toBe('Need input');
  rerender('in_review');
  expect(live()).toBe('');
});

async function openConfirm(stop = vi.fn(async () => {})) {
  const view = bar({ state: 'idle' }, false, stop);
  const trigger = screen.getByRole('button', { name: 'Run options' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Stop this run?',
  });
  return { ...view, stop, trigger, dialog };
}
it('opens a labelled confirmation with initial focus on Cancel and stops nothing yet', async () => {
  const { stop, dialog } = await openConfirm();
  expect(dialog).toHaveAccessibleDescription(/Claude stops working/);
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toHaveFocus(),
  );
  expect(within(dialog).getByRole('button', { name: 'Stop' })).toHaveClass(
    'bg-danger',
    'min-h-11',
  );
  expect(stop).not.toHaveBeenCalled();
});
it('Cancel closes without stopping and returns focus to Run options', async () => {
  const { stop, trigger, dialog } = await openConfirm();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(stop).not.toHaveBeenCalled();
});
it('Escape closes without stopping and returns focus to Run options', async () => {
  const { stop, trigger, dialog } = await openConfirm();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(stop).not.toHaveBeenCalled();
});
it('Confirm stops once even on a double click, and is disabled while pending', async () => {
  let finish!: () => void;
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { dialog } = await openConfirm(stop);
  const confirm = within(dialog).getByRole('button', { name: 'Stop' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(stop).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(confirm).toBeDisabled());
  finish();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(stop).toHaveBeenCalledTimes(1);
});

it('Stop failure closes the dialog, shows the error, refocuses Run options and allows a retry', async () => {
  const stop = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('Stop failed'))
    .mockResolvedValue(undefined);
  const { trigger, dialog } = await openConfirm(stop);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(await screen.findByRole('alert')).toHaveTextContent('Stop failed');
  expect(trigger).toBeEnabled();
  await waitFor(() => expect(trigger).toHaveFocus());
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
  const again = await screen.findByRole('alertdialog');
  fireEvent.click(within(again).getByRole('button', { name: 'Stop' }));
  await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
});
async function confirmStop(stop: () => Promise<void>, onStopped = vi.fn()) {
  render(
    <RunBar
      run={{ ...base, state: 'idle' }}
      onStop={stop}
      onStopped={onStopped}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Run options' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
  return onStopped;
}
it('calls onStopped once after a successful stop, when the dialog has closed', async () => {
  const onStopped = await confirmStop(vi.fn(async () => {}));
  await waitFor(() => expect(onStopped).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
it('does not call onStopped when the stop fails', async () => {
  const onStopped = await confirmStop(
    vi.fn(async () => {
      throw new Error('nope');
    }),
  );
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(onStopped).not.toHaveBeenCalled();
});
it('Escape while Stop is pending closes the dialog without a second stop', async () => {
  let finish!: () => void;
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { dialog } = await openConfirm(stop);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  finish();
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
});
it('does not announce Waiting for you from the bar when a request is pending', () => {
  const live = () =>
    screen
      .getAllByRole('status')
      .map((n) => n.textContent)
      .join('');
  const { rerender } = bar({ state: 'running' });
  rerender({ state: 'running' }, true);
  expect(screen.getByText('Waiting for you')).toBeVisible();
  expect(live()).toBe('');
});

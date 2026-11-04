import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl.js';
afterEach(cleanup);
it('renders SegmentedControl with accessible semantics', () => {
  render(
    <SegmentedControl
      label="Period"
      options={[
        { value: 'day', label: 'Day' },
        { value: 'week', label: 'Week' },
      ]}
      defaultValue="day"
    />,
  );
  expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('selects the next segment with an arrow key', async () => {
  const onValueChange = vi.fn();
  render(
    <SegmentedControl
      label="Period"
      options={[
        { value: 'day', label: 'Day' },
        { value: 'week', label: 'Week' },
      ]}
      defaultValue="day"
      onValueChange={onValueChange}
    />,
  );
  const day = screen.getByRole('button', { name: 'Day' });
  day.focus();
  fireEvent.keyDown(day, { key: 'ArrowRight' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Week' })).toHaveFocus(),
  );
  expect(onValueChange).toHaveBeenCalledWith('week');
});

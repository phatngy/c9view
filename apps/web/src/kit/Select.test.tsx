import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Select } from './Select.js';
afterEach(cleanup);
it('renders Select with accessible semantics', () => {
  render(
    <Select
      label="Model"
      options={[{ value: 'opus', label: 'Opus' }]}
      defaultValue="opus"
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
    'Opus',
  );
});

it('opens with ArrowDown and dismisses with Escape', async () => {
  render(
    <Select
      label="Model"
      options={[
        { value: 'opus', label: 'Opus' },
        { value: 'haiku', label: 'Haiku' },
      ]}
      defaultValue="opus"
    />,
  );
  const trigger = screen.getByRole('combobox', { name: 'Model' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(
    await screen.findByRole('option', { name: 'Haiku' }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
  );
});

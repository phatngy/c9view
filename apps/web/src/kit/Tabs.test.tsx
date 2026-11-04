import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs.js';
afterEach(cleanup);
it('renders Tabs with accessible semantics', () => {
  render(
    <Tabs
      label="Views"
      items={[
        { value: 'one', label: 'One', content: 'First panel' },
        { value: 'two', label: 'Two', content: 'Second panel' },
      ]}
      defaultValue="one"
    />,
  );
  expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tabpanel')).toHaveTextContent('First panel');
});

it('moves between tabs with arrow keys', async () => {
  render(
    <Tabs
      label="Views"
      items={[
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ]}
      defaultValue="a"
    />,
  );
  screen.getByRole('tab', { name: 'Alpha' }).focus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), {
    key: 'ArrowRight',
  });
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus(),
  );
});

it('changes uncontrolled panels and includes count badges', () => {
  render(
    <Tabs
      label="Sessions"
      defaultValue="open"
      items={[
        { value: 'open', label: 'Open', count: 0, content: 'Open sessions' },
        {
          value: 'closed',
          label: 'Closed',
          count: 12,
          content: 'Closed sessions',
        },
      ]}
    />,
  );
  expect(
    within(screen.getByRole('tab', { name: 'Open0' })).getByText('0'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Closed12' }));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Closed sessions');
});

it('keeps controlled selection until its value changes', () => {
  const onValueChange = vi.fn();
  const items = [
    { value: 'a', label: 'Alpha', content: 'Alpha panel' },
    { value: 'b', label: 'Beta', content: 'Beta panel' },
  ];
  const { rerender } = render(
    <Tabs
      label="Views"
      items={items}
      value="a"
      onValueChange={onValueChange}
    />,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
  expect(onValueChange).toHaveBeenCalledWith('b');
  expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Alpha panel');
  rerender(
    <Tabs
      label="Views"
      items={items}
      value="b"
      onValueChange={onValueChange}
    />,
  );
  expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tabpanel')).toHaveTextContent('Beta panel');
});

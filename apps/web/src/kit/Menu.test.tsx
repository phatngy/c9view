import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Menu } from './Menu.js';
afterEach(cleanup);
it('renders Menu with accessible semantics', () => {
  render(
    <Menu trigger={<button>Actions</button>} items={[{ label: 'Copy' }]} />,
  );
  expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute(
    'aria-haspopup',
    'menu',
  );
});

it('opens from the keyboard and closes with Escape', async () => {
  render(
    <Menu trigger={<button>Actions</button>} items={[{ label: 'Copy' }]} />,
  );
  const trigger = screen.getByRole('button', { name: 'Actions' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(
    await screen.findByRole('menuitem', { name: 'Copy' }),
  ).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Copy' }), {
    key: 'Escape',
  });
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('marks the selected radio item and updates selection', async () => {
  const onValueChange = vi.fn();
  render(
    <Menu
      trigger={<button>Theme</button>}
      radioGroup={{
        value: 'system',
        onValueChange,
        items: [
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
  expect(
    await screen.findByRole('menuitemradio', { name: 'System' }),
  ).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
  expect(onValueChange).toHaveBeenCalledWith('dark');
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
  );
});

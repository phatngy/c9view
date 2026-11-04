import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Tooltip } from './Tooltip.js';
afterEach(cleanup);
it('renders Tooltip with accessible semantics', () => {
  render(
    <Tooltip content="Additional help">
      <button>Help</button>
    </Tooltip>,
  );
  expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

it('shows supplementary help on keyboard focus and dismisses with Escape', async () => {
  render(
    <Tooltip content="Additional help">
      <button>Help</button>
    </Tooltip>,
  );
  const trigger = screen.getByRole('button', { name: 'Help' });
  fireEvent.keyDown(document.body, { key: 'Tab' });
  act(() => trigger.focus());
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Additional help',
  );
  fireEvent.keyDown(trigger, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(),
  );
});

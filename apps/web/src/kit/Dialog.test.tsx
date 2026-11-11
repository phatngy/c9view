import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog.js';

afterEach(cleanup);

it('traps focus within the open dialog', async () => {
  render(
    <>
      <button type="button">Open dialog</button>
      <Dialog open onOpenChange={() => {}} title="Details">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>
    </>,
  );

  const first = screen.getByRole('button', { name: 'First' });
  const last = screen.getByRole('button', { name: 'Last' });
  const dialog = screen.getByRole('dialog', { name: 'Details' });
  await waitFor(() => expect(first).toHaveFocus());
  const guards = document.querySelectorAll<HTMLElement>(
    '[data-base-ui-focus-guard]',
  );
  expect(guards.length).toBeGreaterThan(1);
  guards[0]!.focus();
  await waitFor(() =>
    expect(dialog).toContainElement(document.activeElement as HTMLElement),
  );
  expect(document.activeElement).toBe(last);
});

it('closes on Escape and restores focus to the opener', async () => {
  const onOpenChange = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            onOpenChange(next);
          }}
          title="Details"
        >
          <button type="button">Close target</button>
        </Dialog>
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Open dialog' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Details' });
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('labels its dialog surface with the title', () => {
  render(
    <Dialog open onOpenChange={() => {}} title="New session">
      <p>Start a session</p>
    </Dialog>,
  );

  expect(
    screen.getByRole('dialog', { name: 'New session' }),
  ).toBeInTheDocument();
});

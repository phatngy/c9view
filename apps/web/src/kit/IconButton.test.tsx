import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { IconButton } from './IconButton.js';
afterEach(cleanup);
it('renders IconButton with accessible semantics', () => {
  render(<IconButton label="Close">×</IconButton>);
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
});

it('supports keyboard focus with an explicit accessible name', () => {
  render(<IconButton label="Close">×</IconButton>);
  const button = screen.getByRole('button', { name: 'Close' });
  button.focus();
  expect(button).toHaveFocus();
  expect(button.tagName).toBe('BUTTON');
});

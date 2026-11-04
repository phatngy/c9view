import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Kbd } from './Kbd.js';
afterEach(cleanup);
it('renders Kbd with accessible semantics', () => {
  render(<Kbd>⌘K</Kbd>);
  expect(screen.getByText('⌘K').tagName).toBe('KBD');
});

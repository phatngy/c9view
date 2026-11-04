import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Stat } from './Stat.js';
afterEach(cleanup);
it('renders Stat with accessible semantics', () => {
  render(<Stat label="Sessions" value={12} detail="Today" />);
  expect(screen.getByText('Sessions').tagName).toBe('DT');
  expect(screen.getByText('12').tagName).toBe('DD');
});

it('renders an optional hint', () => {
  render(<Stat label="Cost" value="$2.00" hint="This week" />);
  expect(screen.getByText('This week').tagName).toBe('DD');
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Skeleton } from './Skeleton.js';
afterEach(cleanup);
it('renders Skeleton with accessible semantics', () => {
  render(<Skeleton data-testid="loading" />);
  expect(screen.getByTestId('loading')).toHaveAttribute('aria-hidden', 'true');
});

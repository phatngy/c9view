import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.js';
afterEach(cleanup);
it('renders EmptyState with accessible semantics', () => {
  render(
    <EmptyState
      title="No sessions"
      description="Start a conversation"
      action={<button>Refresh</button>}
    />,
  );
  expect(
    screen.getByRole('heading', { name: 'No sessions' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
});

it('supports compact spacing and supporting text', () => {
  const { container } = render(
    <EmptyState compact title="No results" text="Try another search" />,
  );
  expect(container.firstElementChild?.tagName).toBe('P');
  expect(container.firstElementChild).toHaveClass('text-muted');
  expect(container.firstElementChild).not.toHaveClass('border', 'py-6');
  expect(screen.queryByText('Try another search')).not.toBeInTheDocument();
});

it('uses the requested heading level for the full variant', () => {
  render(<EmptyState title="No results" headingLevel={3} />);
  expect(screen.getByRole('heading', { level: 3, name: 'No results' })).toBeInTheDocument();
});

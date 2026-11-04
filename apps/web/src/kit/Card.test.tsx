import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Card } from './Card.js';
afterEach(cleanup);
it('renders Card with accessible semantics', () => {
  render(<Card aria-label="Summary">Content</Card>);
  expect(screen.getByLabelText('Summary')).toHaveTextContent('Content');
});

it('renders an optional title and header action', () => {
  render(
    <Card title="Sessions" action={<button>Refresh</button>}>
      Content
    </Card>,
  );
  expect(screen.getByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Badge } from './Badge.js';
afterEach(cleanup);
it('renders Badge with accessible semantics', () => {
  render(<Badge model="claude-opus-5-5" />);
  expect(screen.getByText('Opus 5.5')).toHaveClass('text-ink');
});

it('supports status tones and known model families', () => {
  render(
    <>
      <Badge tone="need-input">Waiting for input</Badge>
      <Badge tone="model" family="haiku" />
    </>,
  );
  expect(screen.getByText('Waiting for input')).toHaveClass('text-need-input');
  expect(screen.getByText('Haiku')).toHaveClass('text-ink');
});

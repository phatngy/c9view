import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProjectName } from './ProjectName.js';

afterEach(cleanup);

it('keeps the full id available even for a unique name', () => {
  render(<ProjectName name="alpha" id="full-project-id" />);
  expect(screen.getByText('alpha').parentElement).toHaveAttribute(
    'title',
    'full-project-id',
  );
  expect(screen.getByText('alpha')).not.toHaveClass('max-w-[70%]');
});

it('keeps ordinals outside the truncating path in every placement', () => {
  const { rerender } = render(
    <ProjectName
      name="alpha"
      id="full-project-id"
      hint={{ path: '…/github/personal', ordinal: 2 }}
    />,
  );
  const ordinal = screen.getByText('#2');
  expect(ordinal).toHaveClass('shrink-0');
  expect(ordinal.parentElement).toHaveAttribute('title', 'full-project-id');
  expect(screen.getByText('…/github/personal')).toHaveClass(
    'truncate',
    'text-muted',
  );
  rerender(
    <ProjectName
      compact
      name="alpha"
      id="full-project-id"
      hint={{ path: '…/github/personal', ordinal: 2 }}
    />,
  );
  expect(screen.getByText('alpha')).toHaveClass('max-w-[70%]');
  expect(screen.getByText('#2')).toHaveClass('shrink-0');
});

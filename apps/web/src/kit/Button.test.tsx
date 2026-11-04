import { Plus } from 'lucide-react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button } from './Button.js';
afterEach(cleanup);
it('renders Button with accessible semantics', () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute(
    'type',
    'button',
  );
});

it('keeps disabled actions inert and exposes a decorative leading icon', () => {
  const onClick = vi.fn();
  render(
    <Button disabled onClick={onClick} icon={Plus}>
      Add
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Add' });
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
  expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});

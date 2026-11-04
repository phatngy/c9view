import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionControls } from './controls.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('debounces the URL filter update for 250 ms and commits immediately on blur', () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  render(
    <SessionControls
      view="board"
      filter=""
      sort="activity-desc"
      onChange={onChange}
    />,
  );
  const input = screen.getByRole('searchbox', { name: 'Filter sessions' });
  fireEvent.change(input, { target: { value: 'needle' } });

  act(() => vi.advanceTimersByTime(249));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith({ filter: 'needle' });
  act(() => vi.advanceTimersByTime(1));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('commits the local filter immediately on Enter', () => {
  const onChange = vi.fn();
  render(
    <SessionControls
      view="board"
      filter=""
      sort="activity-desc"
      onChange={onChange}
    />,
  );
  const input = screen.getByRole('searchbox', { name: 'Filter sessions' });
  fireEvent.change(input, { target: { value: 'prompt' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith({ filter: 'prompt' });
});

it('debounces a burst of changes from the last keystroke', () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  render(
    <SessionControls
      view="board"
      filter=""
      sort="activity-desc"
      onChange={onChange}
    />,
  );
  const input = screen.getByRole('searchbox', { name: 'Filter sessions' });
  fireEvent.change(input, { target: { value: 'a' } });
  act(() => vi.advanceTimersByTime(100));
  fireEvent.change(input, { target: { value: 'ab' } });
  act(() => vi.advanceTimersByTime(100));
  fireEvent.change(input, { target: { value: 'abc' } });

  act(() => vi.advanceTimersByTime(249));
  expect(onChange).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ filter: 'abc' });
});

it('preserves typing after a commit while the URL prop catches up', () => {
  const onChange = vi.fn();
  const props = {
    view: 'board',
    filter: '',
    sort: 'activity-desc',
    onChange,
  };
  const { rerender } = render(<SessionControls {...props} />);
  const input = screen.getByRole('searchbox', { name: 'Filter sessions' });
  fireEvent.change(input, { target: { value: 'first' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith({ filter: 'first' });

  fireEvent.change(input, { target: { value: 'second' } });
  rerender(<SessionControls {...props} onChange={vi.fn()} />);
  expect(input).toHaveValue('second');

  rerender(<SessionControls {...props} filter="first" />);
  expect(input).toHaveValue('second');
});

it('syncs an external filter prop change into the input', () => {
  const { rerender } = render(
    <SessionControls
      view="board"
      filter="old"
      sort="activity-desc"
      onChange={vi.fn()}
    />,
  );
  const input = screen.getByRole('searchbox', { name: 'Filter sessions' });
  fireEvent.change(input, { target: { value: 'local draft' } });
  rerender(
    <SessionControls
      view="board"
      filter="external"
      sort="activity-desc"
      onChange={vi.fn()}
    />,
  );
  expect(input).toHaveValue('external');
});

it('flushes a pending filter when the controls unmount', () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const { unmount } = render(
    <SessionControls
      view="board"
      filter=""
      sort="activity-desc"
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter sessions' }), {
    target: { value: 'pending' },
  });
  act(() => vi.advanceTimersByTime(100));
  unmount();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ filter: 'pending' });
});

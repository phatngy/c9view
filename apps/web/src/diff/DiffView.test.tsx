import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffHunk } from '@c9view/api';
import { DiffView } from './DiffView.js';
import { buildRows } from './rows.js';
vi.mock('./highlight.js', () => ({
  CodeLine: ({ text }: { text: string }) => <code>{text}</code>,
  languageFor: () => 'text',
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
const hunks: DiffHunk[] = [
  {
    oldStart: 2,
    oldLines: 2,
    newStart: 2,
    newLines: 3,
    lines: [' before', '-old', '+new', '+extra'],
  },
  {
    oldStart: 20,
    oldLines: 1,
    newStart: 21,
    newLines: 1,
    lines: ['-last old', '+last new', '\\ No newline at end of file'],
  },
];
describe('diff renderer', () => {
  it('hides only the header in a bare diff and honors its mode override', () => {
    render(
      <DiffView filePath="bare.ts" hunks={hunks} bare truncated mode="split" />,
    );
    expect(
      screen.getByRole('region', { name: 'Diff for bare.ts' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('bare.ts')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Diff mode/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Truncated diff/)).toBeInTheDocument();
    expect(
      screen.getByText('Unified view on small screens'),
    ).toBeInTheDocument();
  });
  it('shares mode changes with every mounted diff', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <>
        <DiffView filePath="one.ts" hunks={hunks} />
        <DiffView filePath="two.ts" hunks={hunks} />
      </>,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: /Switch to split/ })[0]!,
    );
    expect(screen.getAllByRole('table', { name: 'Split diff' })).toHaveLength(
      2,
    );
    expect(
      screen.getAllByRole('button', { name: /Switch to unified/ }),
    ).toHaveLength(2);
  });
  it('renders multiple hunks, line numbers and counts in unified mode', () => {
    render(<DiffView filePath="src/example.ts" hunks={hunks} kind="update" />);
    expect(
      screen.getByRole('table', { name: 'Unified diff' }),
    ).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('−2')).toBeInTheDocument();
    expect(screen.getByLabelText('Removed line 20')).toHaveTextContent(
      'last old',
    );
    expect(
      screen.getByLabelText('Added line 21, no newline at end of file'),
    ).toHaveTextContent('last new');
    expect(screen.getByText('@@ -20,1 +21,1 @@')).toBeInTheDocument();
  });
  it('pairs replacements in split mode and persists preference', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<DiffView filePath="example.ts" hunks={hunks} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Diff mode: unified. Switch to split',
      }),
    );
    expect(
      screen.getByRole('table', { name: 'Split diff' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Removed line 3').parentElement).toBe(
      screen.getByLabelText('Added line 3').parentElement,
    );
    expect(localStorage.getItem('c9view-diff-mode')).toBe('split');
  });
  it.each([
    ['-a', '\\ No newline at end of file', '+b'],
    ['-a', '+b', '\\ No newline at end of file'],
  ])(
    'attaches no-newline notices without breaking split pairing (%s)',
    (...lines) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      render(
        <DiffView
          filePath="example.txt"
          hunks={[
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines },
          ]}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Switch to split/ }));
      const noticeFollowsRemoval = lines[1] === '\\ No newline at end of file';
      const removed = screen.getByLabelText(
        noticeFollowsRemoval
          ? 'Removed line 1, no newline at end of file'
          : 'Removed line 1',
      );
      const added = screen.getByLabelText(
        noticeFollowsRemoval
          ? 'Added line 1'
          : 'Added line 1, no newline at end of file',
      );
      expect(removed.parentElement).toBe(added.parentElement);
      expect(removed).toHaveAccessibleName(/Removed line 1/);
      expect(
        screen.getAllByLabelText('No newline at end of file'),
      ).toHaveLength(1);
    },
  );
  it('falls back to unified on mobile and folds long context', () => {
    localStorage.setItem('c9view-diff-mode', 'split');
    const context = Array.from({ length: 12 }, (_, i) => ` context ${i}`);
    render(
      <DiffView
        filePath="example.txt"
        hunks={[
          {
            oldStart: 1,
            oldLines: 12,
            newStart: 1,
            newLines: 12,
            lines: context,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('table', { name: 'Unified diff' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('context 5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 6 lines' }));
    expect(screen.getByText('context 5')).toBeInTheDocument();
  });
  it('keeps a folded hunk open when switching unified and split modes', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <DiffView
        filePath="example.txt"
        hunks={[
          {
            oldStart: 1,
            oldLines: 12,
            newStart: 1,
            newLines: 12,
            lines: Array.from({ length: 12 }, (_, i) => ` context ${i}`),
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show 6 lines' }));
    fireEvent.click(screen.getByRole('button', { name: /Switch to split/ }));
    expect(screen.getAllByText('context 5')).toHaveLength(2);
  });
  it('builds a 10k-line patch once in linear time', () => {
    let visits = 0;
    const lines = Array.from(
      { length: 10000 },
      (_, i) => `${i % 2 ? '+' : '-'}line ${i}`,
    );
    const inspected = new Proxy(lines, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) visits++;
        return Reflect.get(target, key, receiver);
      },
    });
    const started = performance.now();
    const result = buildRows([
      {
        oldStart: 1,
        oldLines: 5000,
        newStart: 1,
        newLines: 5000,
        lines: inspected,
      },
    ]);
    expect(performance.now() - started).toBeLessThan(200);
    expect(visits).toBe(10000);
    expect(result.additions).toBe(5000);
    expect(result.deletions).toBe(5000);
    expect(result.unified).toHaveLength(10001);
  });
  it('windows more than 1000 visible rows and exposes notices', () => {
    render(
      <DiffView
        filePath="large.txt"
        truncated
        partial
        tooLarge
        hunks={[
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 2000,
            lines: Array.from({ length: 2000 }, (_, i) => `+line ${i}`),
          },
        ]}
      />,
    );
    expect(screen.getAllByRole('row').length).toBeLessThan(110);
    expect(screen.getAllByRole('note')).toHaveLength(3);
    const scroll = screen.getByRole('table').parentElement!;
    fireEvent.scroll(scroll, { target: { scrollTop: 30000 } });
    expect(screen.getByText('line 1250')).toBeInTheDocument();
  });
});

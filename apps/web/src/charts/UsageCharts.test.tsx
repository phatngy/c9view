import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { UsageResponse } from '@c9view/api';
import {
  familyCostSeries,
  CacheHitChart,
  DailyCostChart,
  ProjectCostChart,
} from './UsageCharts.js';
import {
  cachePath,
  costSeries,
  modelSlots,
  projectBars,
  niceMaximum,
  dateTickIndexes,
  stackGeometry,
} from './data.js';
import { readFileSync } from 'node:fs';
const tokens = {
  input: 10,
  output: 1,
  cacheRead: 20,
  cacheCreation: 0,
  thinking: 0,
};
const data: UsageResponse = {
  tz: 'UTC',
  from: '2026-10-24',
  to: '2026-10-26',
  totals: { costUsd: 6, tokens },
  days: [
    {
      date: '2026-10-24',
      costUsd: 3,
      tokens,
      byModel: [
        { model: 'Opus', costUsd: 1, tokens },
        { model: 'Sonnet', costUsd: 2, tokens },
      ],
    },
    {
      date: '2026-10-25',
      costUsd: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        thinking: 0,
      },
      byModel: [],
    },
    {
      date: '2026-10-26',
      costUsd: 3,
      tokens,
      byModel: [{ model: 'Opus', costUsd: 3, tokens }],
    },
  ],
  byModel: [
    { model: 'Opus', costUsd: 4, tokens },
    { model: 'Sonnet', costUsd: 2, tokens },
  ],
  byProject: [{ projectId: 'a', name: 'Project A', costUsd: 6, tokens }],
  cacheHit: [
    { date: '2026-10-24', ratio: 0.5 },
    { date: '2026-10-25', ratio: null },
    { date: '2026-10-26', ratio: 1 },
  ],
};
afterEach(cleanup);
it('keeps stack extent proportional to total with gaps between nonzero segments', () => {
  const stack = stackGeometry([10, 0, 20, 30], 120);
  expect(stack[2]!.bottom - stack[0]!.height).toBe(2);
  expect(stack[3]!.bottom + stack[3]!.height).toBeCloseTo(120);
  expect(stack.reduce((n, s) => n + s.height, 0)).toBe(116);
});
it('keeps entity colors when another model is filtered out and folds the tail into Other', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `model-${i}`);
  const slots = modelSlots(ids);
  const filtered = {
    ...data,
    byModel: [{ model: ids[3]!, costUsd: 1, tokens }],
  };
  expect(costSeries(filtered, ids).slots.get(ids[3]!)).toBe(slots.get(ids[3]!));
  const many = {
    ...data,
    byModel: ids.map((model) => ({ model, costUsd: 1, tokens })),
    days: [
      {
        ...data.days[0]!,
        costUsd: 10,
        byModel: ids.map((model) => ({ model, costUsd: 1, tokens })),
      },
    ],
  };
  const series = costSeries(many, ids);
  expect(series.names).toHaveLength(9);
  expect(series.days[0]!.values.find((v) => v.name === 'Other')!.value).toBe(2);
});
it('excludes the synthetic model from series and legends while retaining real model slots', () => {
  const withSynthetic: UsageResponse = {
    ...data,
    byModel: [{ model: '<synthetic>', costUsd: 0, tokens }, ...data.byModel],
    days: data.days.map((day) => ({
      ...day,
      byModel: [
        ...day.byModel,
        ...(day.date === '2026-10-24'
          ? [{ model: '<synthetic>', costUsd: 0, tokens }]
          : []),
      ],
    })),
  };
  expect(modelSlots(['<synthetic>', 'Opus', 'Sonnet']).get('Opus')).toBe(1);
  expect(
    costSeries(withSynthetic, ['<synthetic>', 'Opus', 'Sonnet']).names,
  ).toEqual(['Opus', 'Sonnet']);
  const { container } = render(
    <DailyCostChart
      data={withSynthetic}
      modelIds={['<synthetic>', 'Opus', 'Sonnet']}
    />,
  );
  expect(container.querySelector('.chart-legend')).not.toHaveTextContent(
    '<synthetic>',
  );
  expect(
    costSeries(withSynthetic, ['<synthetic>', 'Opus', 'Sonnet']).days[0]!
      .values,
  ).not.toContainEqual(expect.objectContaining({ name: '<synthetic>' }));
});
it('uses clean nice cost ticks for small and large values', () => {
  for (const peak of [0, 0.004, 0.3, 1, 7, 9.99, 33, 60, 107.9, 2345]) {
    const { max, step } = niceMaximum(peak);
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) =>
      Number((i * step).toPrecision(12)),
    );
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(
      ticks.every(
        (tick) => String(tick) === String(Number(tick.toPrecision(12))),
      ),
    ).toBe(true);
  }
  expect(niceMaximum(60)).toEqual({ max: 60, step: 20 });
  expect(niceMaximum(7)).toEqual({ max: 8, step: 2 });
  expect(niceMaximum(33)).toEqual({ max: 40, step: 10 });
  const tiny: UsageResponse = {
    ...data,
    days: data.days.map((day, i) => ({
      ...day,
      costUsd: i === 0 ? 0.004 : 0,
      byModel: i === 0 ? [{ model: 'Opus', costUsd: 0.004, tokens }] : [],
    })),
  };
  const { container } = render(
    <DailyCostChart data={tiny} modelIds={['Opus']} />,
  );
  expect(container.querySelector('svg')).toHaveTextContent('$0.0010');
  cleanup();
  expect(dateTickIndexes(30, 289)).toHaveLength(3);
  expect(dateTickIndexes(30, 1166)).toHaveLength(6);
  expect(dateTickIndexes(30, 1166).at(-1)).toBe(29);
});
it('rounds only the topmost nonzero segment in a three-model stack', () => {
  const three: UsageResponse = {
    ...data,
    days: [
      {
        ...data.days[0]!,
        costUsd: 6,
        byModel: ['Opus', 'Sonnet', 'Haiku'].map((model) => ({
          model,
          costUsd: 2,
          tokens,
        })),
      },
    ],
    byModel: ['Opus', 'Sonnet', 'Haiku'].map((model) => ({
      model,
      costUsd: 2,
      tokens,
    })),
  };
  const { container } = render(
    <DailyCostChart data={three} modelIds={['Opus', 'Sonnet', 'Haiku']} />,
  );
  const marks = [...container.querySelectorAll<SVGPathElement>('.chart-mark')];
  expect(marks).toHaveLength(3);
  expect(
    marks.filter((mark) => mark.getAttribute('d')?.includes('Q')),
  ).toHaveLength(1);
  expect(new Set(marks.map((mark) => mark.dataset.series)).size).toBe(3);
  const css = readFileSync('src/style.css', 'utf8');
  expect(css).toContain('@media (forced-colors: active)');
  for (const slot of ['1', '2', '3'])
    expect(css).toContain(`.chart-mark[data-series='${slot}']`);
  for (const slot of ['1', '2', '3'])
    expect(css).toContain(`.chart-legend i[data-series='${slot}']`);
});
it('places the peak label on the selected isolated series peak', () => {
  const { container } = render(
    <DailyCostChart data={data} modelIds={['Opus', 'Sonnet']} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Opus' }));
  const peak = container.querySelector('[aria-label="Peak day 2026-10-26"]');
  expect(peak).toBeInTheDocument();
  expect(peak).toHaveTextContent('$3.00');
  expect(
    container.querySelector('[aria-label="Peak day 2026-10-24"]'),
  ).toBeNull();
});
it('uses fixed-height SVGs with CSS-pixel coordinates and a nonwrapping table toggle', () => {
  const { container } = render(
    <>
      <DailyCostChart data={data} modelIds={['Opus', 'Sonnet']} />
      <CacheHitChart data={data} />
    </>,
  );
  for (const svg of container.querySelectorAll('svg')) {
    expect(svg).not.toHaveAttribute('viewBox');
    expect(svg).toHaveAttribute('height', '270');
  }
  expect(container.querySelectorAll('.chart-table-toggle')).toHaveLength(2);
});
it('shows the same daily data in its table and tooltip on keyboard focus; arrows move days', () => {
  const { container } = render(
    <DailyCostChart data={data} modelIds={['Opus', 'Sonnet']} />,
  );
  const hits = container.querySelectorAll<SVGRectElement>('[data-day]');
  fireEvent.focus(hits[0]!);
  expect(screen.getByRole('status')).toHaveTextContent('2026-10-24');
  expect(screen.getByRole('status')).toHaveTextContent('$3.00');
  const tooltipModels = [
    ...screen.getByRole('status').querySelectorAll('span strong'),
  ]
    .map((strong) => strong.parentElement?.textContent)
    .filter((text) => text?.includes('Opus') || text?.includes('Sonnet'));
  expect(tooltipModels[0]).toContain('Sonnet');
  expect(tooltipModels[1]).toContain('Opus');
  fireEvent.keyDown(hits[0]!, { key: 'ArrowRight' });
  expect(hits[1]).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('2026-10-25');
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows).toHaveLength(4);
  expect(rows[1]).toHaveTextContent('2026-10-24');
  expect(rows[1]).toHaveTextContent('$1.00');
  expect(rows[1]).toHaveTextContent('$2.00');
  expect(rows[1]).toHaveTextContent('$3.00');
});
it('renders null cache days as gaps and exposes ratios in a table', () => {
  const path = cachePath(
    data.cacheHit,
    (i) => i,
    (v) => v,
  );
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path).not.toContain('L');
  render(<CacheHitChart data={data} />);
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  expect(screen.getByRole('table')).toHaveTextContent('No usage');
  expect(screen.getByRole('table')).toHaveTextContent('50.0%');
});
it('folds projects after eight into Other and preserves the totals in the table', () => {
  const many = {
    ...data,
    byProject: Array.from({ length: 10 }, (_, i) => ({
      projectId: String(i),
      name: `Project ${i}`,
      costUsd: 10 - i,
      tokens,
    })),
  };
  expect(projectBars(many).at(-1)).toMatchObject({ name: 'Other', value: 3 });
  render(<ProjectCostChart data={many} />);
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  expect(screen.getByRole('table')).toHaveTextContent('Other');
  expect(screen.getByRole('table')).toHaveTextContent('$3.00');
});
it('aggregates versions by family and uses fixed family colors and forced-colors slots', () => {
  const entries = [
    'claude-opus-4',
    'claude-opus-4-1',
    'claude-sonnet-4',
    'claude-haiku-4',
    'claude-fable-1',
    'custom-model',
  ].map((model) => ({ model, costUsd: 1, tokens }));
  const families = {
    ...data,
    byModel: entries,
    days: [{ ...data.days[0]!, byModel: entries, costUsd: 6 }],
  };
  const { container, rerender } = render(<DailyCostChart data={families} />);
  const marks = [...container.querySelectorAll('.chart-mark')];
  expect(marks).toHaveLength(5);
  expect(
    marks.map((mark) => [
      mark.getAttribute('data-series'),
      mark.getAttribute('fill'),
    ]),
  ).toEqual([
    ['1', 'var(--model-opus)'],
    ['2', 'var(--model-sonnet)'],
    ['3', 'var(--model-haiku)'],
    ['4', 'var(--model-fable)'],
    ['0', 'var(--model-other)'],
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')[0]!.children).toHaveLength(7);
  expect(
    within(table).getByRole('cell', { name: '≈ $2.00' }),
  ).toBeInTheDocument();
  rerender(
    <DailyCostChart
      data={{
        ...families,
        byModel: entries.slice(2, 3),
        days: [{ ...data.days[0]!, byModel: entries.slice(2, 3), costUsd: 1 }],
      }}
    />,
  );
  const mark = container.querySelector('.chart-mark');
  expect(mark).toHaveAttribute('data-series', '2');
  expect(mark).toHaveAttribute('fill', 'var(--model-sonnet)');
});

it('merges two versions of one family into one cost series across days', () => {
  const first = { model: 'claude-sonnet-4', costUsd: 2, tokens };
  const second = { model: 'claude-sonnet-4-5', costUsd: 3, tokens };
  const series = familyCostSeries({
    ...data,
    byModel: [first, second],
    days: [
      { ...data.days[0]!, costUsd: 5, byModel: [first, second] },
      { ...data.days[1]!, costUsd: 3, byModel: [second] },
    ],
  });
  expect(series.names).toEqual(['Sonnet']);
  expect([...series.slots]).toEqual([['Sonnet', 2]]);
  expect(series.days).toEqual([
    { date: '2026-10-24', total: 5, values: [{ name: 'Sonnet', value: 5 }] },
    { date: '2026-10-25', total: 3, values: [{ name: 'Sonnet', value: 3 }] },
  ]);
});

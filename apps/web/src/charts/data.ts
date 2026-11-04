import type { UsageResponse } from '@c9view/api';
export function modelSlots(ids: string[]) {
  return new Map(
    [...new Set(ids.filter((id) => id !== '<synthetic>'))]
      .sort()
      .map((id, index) => [id, index < 8 ? index + 1 : 0]),
  );
}
export const seriesColor = (slot: number) =>
  slot ? `var(--series-${slot})` : 'var(--series-other)';
export function costSeries(data: UsageResponse, ids: string[]) {
  const slots = modelSlots(ids);
  const names = [
    ...new Set(
      data.byModel
        .filter(({ model }) => model !== '<synthetic>')
        .map(({ model }) => ((slots.get(model) ?? 0) ? model : 'Other')),
    ),
  ];
  names.sort(
    (a, b) =>
      (a === 'Other' ? 9 : (slots.get(a) ?? 0)) -
      (b === 'Other' ? 9 : (slots.get(b) ?? 0)),
  );
  return {
    slots,
    names,
    days: data.days.map((day) => ({
      date: day.date,
      total: day.costUsd,
      values: names.map((name) => ({
        name,
        value: day.byModel
          .filter(
            ({ model }) =>
              model !== '<synthetic>' &&
              (name === 'Other' ? !(slots.get(model) ?? 0) : model === name),
          )
          .reduce((sum, m) => sum + m.costUsd, 0),
      })),
    })),
  };
}
/** Gap space is reserved within the total height, preserving the stack's extent. */
export function stackGeometry(values: number[], height: number) {
  const total = values.reduce((a, b) => a + b, 0);
  const count = values.filter((v) => v > 0).length;
  const gap = count > 1 ? Math.min(2, height / (count * 2)) : 0;
  const ink = Math.max(0, height - gap * Math.max(0, count - 1));
  let bottom = 0;
  return values.map((value) => {
    const h = total ? (value / total) * ink : 0;
    const segment = { bottom, height: h, gap: value > 0 ? gap : 0 };
    if (value > 0) bottom += h + gap;
    return segment;
  });
}
export function cachePath(
  points: UsageResponse['cacheHit'],
  x: (i: number) => number,
  y: (v: number) => number,
) {
  let pen = false;
  return points
    .map((p, i) => {
      if (p.ratio === null) {
        pen = false;
        return '';
      }
      const command = `${pen ? 'L' : 'M'}${x(i)},${y(p.ratio)}`;
      pen = true;
      return command;
    })
    .join(' ');
}
export function projectBars(data: UsageResponse) {
  const rows = data.byProject
    .slice(0, 8)
    .map((p) => ({ name: p.name, id: p.projectId, value: p.costUsd }));
  if (data.byProject.length > 8)
    rows.push({
      name: 'Other',
      id: 'other',
      value: data.byProject.slice(8).reduce((n, p) => n + p.costUsd, 0),
    });
  return rows;
}

/** Choose a clean ceiling with four to six labeled ticks. */
export function niceMaximum(value: number) {
  const ceiling = value > 0 ? value : 0.01;
  const power = 10 ** Math.floor(Math.log10(ceiling));
  const candidates = [-1, 0, 1, 2].flatMap((offset) =>
    [1, 2, 2.5, 5].map((multiplier) => multiplier * power * 10 ** offset),
  );
  const step = candidates.find((candidate) => {
    const intervals = Math.ceil(ceiling / candidate);
    return intervals >= 3 && intervals <= 5;
  })!;
  const round = (n: number) => Number(n.toPrecision(12));
  return { max: round(Math.ceil(ceiling / step) * step), step: round(step) };
}

/** Select a small number of evenly spaced date labels for the available width. */
export function dateTickIndexes(count: number, plotWidth: number) {
  if (count <= 0) return [];
  const tickCount = Math.min(
    count,
    Math.max(3, Math.min(6, Math.floor(plotWidth / 110))),
  );
  if (tickCount === 1) return [0];
  return Array.from({ length: tickCount }, (_, i) =>
    Math.round((i * (count - 1)) / (tickCount - 1)),
  );
}

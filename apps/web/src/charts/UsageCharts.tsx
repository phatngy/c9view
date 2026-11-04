import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { UsageResponse } from '@c9view/api';
import { money as usdMoney } from '../ui.js';
import { modelFamily, type ModelFamily } from '../kit/model.js';
import {
  cachePath,
  projectBars,
  stackGeometry,
  niceMaximum,
  dateTickIndexes,
} from './data.js';

const money = (value: number) => `≈ ${usdMoney(value)}`;

// Slots stay fixed when a family disappears after changing the range or project.
const familySlots: Record<ModelFamily, number> = {
  opus: 1,
  sonnet: 2,
  haiku: 3,
  fable: 4,
  other: 0,
};
const families = Object.keys(familySlots) as ModelFamily[];
const seriesColor = (slot: number) =>
  `var(--model-${families.find((family) => familySlots[family] === slot) ?? 'other'})`;
export function familyCostSeries(data: UsageResponse) {
  const present = new Set(
    [...data.byModel, ...data.days.flatMap((day) => day.byModel)]
      .filter((entry) => entry.model !== '<synthetic>')
      .map((entry) => modelFamily(entry.model)),
  );
  const selected = families.filter((family) => present.has(family));
  const label = (family: ModelFamily) =>
    family[0]!.toUpperCase() + family.slice(1);
  return {
    names: selected.map(label),
    slots: new Map(
      selected.map((family) => [label(family), familySlots[family]]),
    ),
    days: data.days.map((day) => ({
      date: day.date,
      total: day.costUsd,
      values: selected.map((family) => ({
        name: label(family),
        value: day.byModel
          .filter(
            (entry) =>
              entry.model !== '<synthetic>' &&
              modelFamily(entry.model) === family,
          )
          .reduce((sum, entry) => sum + entry.costUsd, 0),
      })),
    })),
  };
}

function Chart({
  title,
  children,
  table,
}: {
  title: string;
  children: ReactNode;
  table: ReactNode;
}) {
  const [tabular, setTabular] = useState(false);
  return (
    <figure className="panel usage-chart">
      <figcaption>
        <h3>
          {title.includes('cost') ? (
            <a href="#api-equivalent-cost">{title}</a>
          ) : (
            title
          )}
        </h3>
        <button
          className="chart-table-toggle"
          type="button"
          aria-pressed={tabular}
          onClick={() => setTabular(!tabular)}
        >
          Table
        </button>
      </figcaption>
      <div hidden={tabular}>{children}</div>
      {tabular && <div className="chart-table">{table}</div>}
    </figure>
  );
}
function moveDay(
  event: KeyboardEvent<SVGRectElement>,
  index: number,
  count: number,
) {
  let next: number;
  if (event.key === 'ArrowRight') next = Math.min(count - 1, index + 1);
  else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = count - 1;
  else return;
  event.preventDefault();
  event.currentTarget.parentElement
    ?.querySelectorAll<SVGRectElement>('[data-day]')
    [next]?.focus();
}
function topBar(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}
function rectBar(x: number, y: number, width: number, height: number) {
  return `M${x},${y}h${width}v${height}h-${width}Z`;
}
const pct = (n: number | null) =>
  n === null ? 'No usage' : `${(n * 100).toFixed(1)}%`;
const axisCost = (value: number, max: number) => {
  const digits = max >= 0.1 ? 2 : max >= 0.01 ? 3 : 4;
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};
const left = 58,
  base = 224,
  top = 28;
function usePlotWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, entry.contentRect.width));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width, right: width - 28, plotWidth: width - left - 28 };
}
function Axes({
  max,
  step,
  right,
  percent = false,
}: {
  max: number;
  step?: number;
  right: number;
  percent?: boolean;
}) {
  return (
    <>
      {Array.from(
        { length: Math.round(max / (step ?? max / 5)) + 1 },
        (_, i) => {
          const value = Number((i * (step ?? max / 5)).toPrecision(12));
          const fraction = value / max;
          return (
            <g key={value}>
              <line
                className="chart-grid"
                x1={left}
                x2={right}
                y1={base - fraction * (base - top)}
                y2={base - fraction * (base - top)}
              />
              <text
                x={left - 8}
                y={base - fraction * (base - top) + 4}
                textAnchor="end"
              >
                {percent ? `${fraction * 100}%` : axisCost(value, max)}
              </text>
            </g>
          );
        },
      )}
    </>
  );
}
export function DailyCostChart({
  data,
}: {
  data: UsageResponse;
  modelIds?: string[];
}) {
  const { ref, width: W, right } = usePlotWidth();
  const { slots, names, days } = familyCostSeries(data);
  const [active, setActive] = useState<number | null>(null);
  const [isolated, setIsolated] = useState<string | null>(null);
  const id = useId();
  const { max, step: axisStep } = niceMaximum(
    Math.max(
      0,
      ...days.map((d) =>
        isolated
          ? (d.values.find((v) => v.name === isolated)?.value ?? 0)
          : d.total,
      ),
    ),
  );
  const step = (right - left) / days.length;
  const width = Math.min(20, Math.max(0.1, step - 2));
  const x = (i: number) => left + (i + 0.5) * step;
  const detail = active === null ? null : days[active];
  const valueOf = (d: (typeof days)[number]) =>
    isolated
      ? (d.values.find((v) => v.name === isolated)?.value ?? 0)
      : d.total;
  const peak = days.reduce(
    (best, d, i) => (valueOf(d) > valueOf(days[best]!) ? i : best),
    0,
  );
  return (
    <Chart
      title="Daily API-equivalent cost by model"
      table={
        <table>
          <caption>Daily API-equivalent cost (USD)</caption>
          <thead>
            <tr>
              <th>Date</th>
              {names.map((name) => (
                <th key={name}>{name}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <th>{d.date}</th>
                {d.values.map((v) => (
                  <td key={v.name}>{money(v.value)}</td>
                ))}
                <td>{money(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="usage-plot" ref={ref}>
        <svg
          width={W}
          height={270}
          role="img"
          aria-label={`Daily API-equivalent cost from ${data.from} to ${data.to}; total ${money(data.totals.costUsd)}. Arrow keys move between days.`}
        >
          <Axes max={max} step={axisStep} right={right} />
          {days.map((day, i) => {
            const values = day.values.map((v) =>
              isolated && v.name !== isolated ? 0 : v.value,
            );
            const sum = values.reduce((a, b) => a + b, 0);
            const geometry = stackGeometry(values, (sum / max) * (base - top));
            return (
              <g key={day.date}>
                {geometry.map(
                  (s, j) =>
                    s.height > 0 && (
                      <path
                        data-series={slots.get(names[j]!) ?? 0}
                        className="chart-mark"
                        key={j}
                        d={(geometry
                          .slice(j + 1)
                          .some((later) => later.height > 0)
                          ? rectBar
                          : topBar)(
                          x(i) - width / 2,
                          base - s.bottom - s.height,
                          width,
                          s.height,
                        )}
                        fill={seriesColor(slots.get(names[j]!) ?? 0)}
                      />
                    ),
                )}
                {i === peak && sum > 0 && (
                  <g aria-label={`Peak day ${day.date}`}>
                    <text
                      x={x(i)}
                      y={Math.max(18, base - (sum / max) * (base - top) - 8)}
                      textAnchor="middle"
                    >
                      {money(sum)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          <g>
            {days.map((day, i) => (
              <rect
                data-day={i}
                key={day.date}
                className="chart-hit"
                x={x(i) - step / 2}
                y={top}
                width={step}
                height={base - top + 12}
                tabIndex={
                  active === null ? (i === 0 ? 0 : -1) : active === i ? 0 : -1
                }
                aria-label={`${day.date}: ${day.values.map((v) => `${v.name} ${money(v.value)}`).join(', ')}; total ${money(day.total)}`}
                aria-describedby={detail ? id : undefined}
                onFocus={() => setActive(i)}
                onPointerMove={() => setActive(i)}
                onClick={() => setActive(i)}
                onKeyDown={(e) => moveDay(e, i, days.length)}
              />
            ))}
          </g>
          {dateTickIndexes(days.length, right - left).map((i, tick) => (
            <text
              key={days[i]!.date}
              x={x(i)}
              y={254}
              textAnchor={
                tick === dateTickIndexes(days.length, right - left).length - 1
                  ? 'end'
                  : 'middle'
              }
            >
              {new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(`${days[i]!.date}T00:00:00Z`))}
            </text>
          ))}
        </svg>
      </div>
      {names.length >= 2 && (
        <div className="chart-legend" aria-label="Models; select to isolate">
          {names.map((name) => (
            <button
              key={name}
              aria-pressed={isolated === name}
              onClick={() => setIsolated(isolated === name ? null : name)}
            >
              <i
                data-series={slots.get(name) ?? 0}
                style={{ background: seriesColor(slots.get(name) ?? 0) }}
              />
              {name}
            </button>
          ))}
        </div>
      )}
      {names.length <= 4 && (
        <p className="text-xs text-muted">
          {names
            .map(
              (name) =>
                `${name}: ${money(days.reduce((n, d) => n + (d.values.find((v) => v.name === name)?.value ?? 0), 0))}`,
            )
            .join(' · ')}
        </p>
      )}
      <div className="chart-tooltip" id={id} role="status">
        {detail ? (
          <>
            <span>{detail.date}</span>
            {[...detail.values].reverse().map((v) => (
              <span key={v.name}>
                <i
                  style={{ background: seriesColor(slots.get(v.name) ?? 0) }}
                />
                <strong>{money(v.value)}</strong> {v.name}
              </span>
            ))}
            <span>
              <strong>{money(detail.total)}</strong> total
            </span>
          </>
        ) : (
          'Hover, tap, or focus a day for details.'
        )}
      </div>
    </Chart>
  );
}
export function CacheHitChart({ data }: { data: UsageResponse }) {
  const { ref, width: W, right } = usePlotWidth();
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const x = (i: number) =>
    left + ((i + 0.5) * (right - left)) / data.cacheHit.length;
  const y = (v: number) => base - v * (base - top);
  const last = data.cacheHit.findLastIndex((d) => d.ratio !== null);
  const detail = active === null ? null : data.cacheHit[active];
  return (
    <Chart
      title="Daily cache-hit ratio"
      table={
        <table>
          <caption>Cache read / (cache read + input + cache creation)</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Cache-hit ratio</th>
            </tr>
          </thead>
          <tbody>
            {data.cacheHit.map((d) => (
              <tr key={d.date}>
                <th>{d.date}</th>
                <td>{pct(d.ratio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="usage-plot" ref={ref}>
        <svg
          width={W}
          height={270}
          role="img"
          aria-label={`Daily cache-hit ratio, 0 to 100 percent, ${data.from} to ${data.to}. Days without usage are gaps. Arrow keys move between days.`}
        >
          <Axes max={1} step={0.2} right={right} percent />
          <path className="chart-line" d={cachePath(data.cacheHit, x, y)} />
          {data.cacheHit.map(
            (d, i) =>
              d.ratio !== null &&
              (i === last ||
                active === i ||
                data.cacheHit[i - 1]?.ratio == null ||
                data.cacheHit[i + 1]?.ratio == null) && (
                <circle
                  className="chart-dot"
                  key={d.date}
                  cx={x(i)}
                  cy={y(d.ratio)}
                  r={4}
                />
              ),
          )}
          {last >= 0 && (
            <text
              x={x(last)}
              y={Math.max(16, y(data.cacheHit[last]!.ratio!) - 12)}
              textAnchor="middle"
            >
              {pct(data.cacheHit[last]!.ratio)}
            </text>
          )}
          {active !== null && (
            <line
              className="chart-crosshair"
              x1={x(active)}
              x2={x(active)}
              y1={top}
              y2={base}
            />
          )}
          <g>
            {data.cacheHit.map((d, i) => (
              <rect
                data-day={i}
                key={d.date}
                className="chart-hit"
                x={x(i) - (right - left) / data.cacheHit.length / 2}
                y={top}
                width={(right - left) / data.cacheHit.length}
                height={base - top + 12}
                tabIndex={
                  active === null ? (i === 0 ? 0 : -1) : active === i ? 0 : -1
                }
                aria-label={`${d.date}: ${pct(d.ratio)}`}
                aria-describedby={detail ? id : undefined}
                onFocus={() => setActive(i)}
                onPointerMove={() => setActive(i)}
                onClick={() => setActive(i)}
                onKeyDown={(e) => moveDay(e, i, data.cacheHit.length)}
              />
            ))}
          </g>
          {dateTickIndexes(data.cacheHit.length, right - left).map(
            (i, tick, indexes) => (
              <text
                key={data.cacheHit[i]!.date}
                x={x(i)}
                y={254}
                textAnchor={tick === indexes.length - 1 ? 'end' : 'middle'}
              >
                {new Intl.DateTimeFormat('en-US', {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(`${data.cacheHit[i]!.date}T00:00:00Z`))}
              </text>
            ),
          )}
        </svg>
      </div>
      <p className="text-xs text-muted">
        Cache read ÷ (cache read + input + cache creation). Empty days are gaps.
      </p>
      <div className="chart-tooltip" id={id} role="status">
        {detail
          ? `${detail.date} · ${pct(detail.ratio)}`
          : 'Hover, tap, or focus a day for details.'}
      </div>
    </Chart>
  );
}
export function ProjectCostChart({ data }: { data: UsageResponse }) {
  const rows = projectBars(data);
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0.01, ...rows.map((p) => p.value));
  return (
    <Chart
      title="API-equivalent cost by project"
      table={
        <table>
          <caption>Project API-equivalent cost (USD), top 8 + Other</caption>
          <thead>
            <tr>
              <th>Project</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <th>{p.name}</th>
                <td>{money(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div
        className="project-cost-bars"
        role="list"
        aria-label={`API-equivalent cost by project, top eight plus Other; ${rows.length} bars. Baseline zero.`}
      >
        {rows.map((p) => (
          <div
            className="project-cost-row"
            key={p.id}
            role="listitem"
            tabIndex={0}
            onFocus={() => setActive(p.id)}
            onPointerMove={() => setActive(p.id)}
            onClick={() => setActive(p.id)}
            aria-label={`${p.name}: ${money(p.value)}`}
          >
            <div className="project-cost-label">
              <span>{p.name}</span>
              <span>{money(p.value)}</span>
            </div>
            <div className="project-cost-track" aria-hidden="true">
              <div
                className="project-cost-fill"
                style={{
                  width: `${(p.value / max) * 100}%`,
                  background:
                    p.id === 'other' ? 'var(--model-other)' : 'var(--accent)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        USD · baseline $0 · top 8 + Other
      </p>
      <div className="chart-tooltip" role="status">
        {active
          ? rows
              .filter((p) => p.id === active)
              .map((p) => `${p.name}: ${money(p.value)}`)
          : 'Hover, tap, or focus a project for details.'}
      </div>
    </Chart>
  );
}

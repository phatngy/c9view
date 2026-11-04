import { HttpError } from '../api.js';
import { useRangeUsage } from '../overview/usage.js';
import { Loading, money, number, total } from '../ui.js';
import {
  CacheHitChart,
  DailyCostChart,
  ProjectCostChart,
} from '../charts/UsageCharts.js';
export function UsageSection({
  projectId,
  range,
  showSummary = true,
}: {
  projectId?: string;
  range: number;
  showSummary?: boolean;
}) {
  const query = useRangeUsage(range, projectId);
  const data = query.data;
  const denominator = data
    ? data.totals.tokens.cacheRead +
      data.totals.tokens.input +
      data.totals.tokens.cacheCreation
    : 0;
  return (
    <section className="usage-section" aria-label="Usage">
      <h2>Usage</h2>
      <p className="text-xs text-muted">
        {query.data?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone} ·{' '}
        <a href="#api-equivalent-cost">≈ API-equivalent cost estimates</a>
      </p>
      {query.error instanceof HttpError && query.error.status === 503 ? (
        <p role="status">Charts are available once indexing finishes</p>
      ) : query.error ? (
        <p role="alert">
          Unable to load usage.{' '}
          <button
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : !data ? (
        <Loading label="Loading usage" />
      ) : (
        <div
          style={{ opacity: query.isFetching ? 0.6 : 1 }}
          aria-busy={query.isFetching}
        >
          {showSummary && (
            <div className="usage-stats">
              {[
                ['API-equivalent cost', `≈ ${money(data.totals.costUsd)}`],
                ['Total tokens', number(total(data.totals.tokens))],
                [
                  'Overall cache-hit ratio',
                  denominator
                    ? `${((100 * data.totals.tokens.cacheRead) / denominator).toFixed(1)}%`
                    : 'No usage',
                ],
              ].map(([label, value]) => (
                <div className="panel" key={label}>
                  <p className="text-xs text-muted">
                    {label === 'API-equivalent cost' ? (
                      <a href="#api-equivalent-cost">{label}</a>
                    ) : (
                      label
                    )}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          )}
          <DailyCostChart
            key={`${data.from}:${data.to}:${projectId ?? ''}`}
            data={data}
          />
          <CacheHitChart key={`${data.from}:${data.to}`} data={data} />
          {!projectId && <ProjectCostChart data={data} />}
        </div>
      )}
    </section>
  );
}

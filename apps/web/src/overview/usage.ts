import { useUsage } from '../api.js';

export const rangeOptions = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '366', label: 'All' },
];

export function useRangeUsage(range: number, projectId = '') {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const to = ['year', 'month', 'day']
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join('-');
  const from = new Date(Date.parse(to) - (range - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  return useUsage({ from, to, tz, projectId });
}

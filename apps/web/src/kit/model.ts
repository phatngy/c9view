export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'other';
export function modelFamily(model: string): ModelFamily {
  const normalized = model.toLowerCase();
  return (
    (['opus', 'sonnet', 'haiku', 'fable'] as const).find((family) =>
      normalized.includes(family),
    ) ?? 'other'
  );
}
export function modelLabel(model: string): string {
  const family = modelFamily(model);
  if (family === 'other') return model;
  const name = family[0]!.toUpperCase() + family.slice(1);
  const normalized = model
    .toLowerCase()
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
  const after = normalized
    .split(family)[1]
    ?.match(/^[-_](\d+(?:[-_.]\d+)?)/)?.[1];
  const before = normalized
    .split(family)[0]
    ?.match(/(\d+(?:[-_.]\d+)?)[-_]$/)?.[1];
  const version = after ?? before;
  return version ? `${name} ${version.replace(/[-_]/g, '.')}` : model;
}

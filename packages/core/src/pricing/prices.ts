import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import bundledPrices from './bundled-prices.json' with { type: 'json' };

export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  longContext?:
    | {
        thresholdTokens: number;
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite5m: number;
        cacheWrite1h: number;
      }
    | undefined;
};

export type PriceTable = {
  source: string;
  date: string;
  prices: Record<string, ModelPrice>;
};

export type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation5m?: number;
  cacheCreation1h?: number;
  cacheCreation?: number;
};

export type ResolvedPrice = {
  price: ModelPrice;
  matchedAs: string;
  exact: boolean;
};

const modelPriceSchema = z.object({
  input: z.number().finite().nonnegative(),
  output: z.number().finite().nonnegative(),
  cacheRead: z.number().finite().nonnegative(),
  cacheWrite5m: z.number().finite().nonnegative(),
  cacheWrite1h: z.number().finite().nonnegative(),
  longContext: z
    .object({
      thresholdTokens: z.number().finite().nonnegative(),
      input: z.number().finite().nonnegative(),
      output: z.number().finite().nonnegative(),
      cacheRead: z.number().finite().nonnegative(),
      cacheWrite5m: z.number().finite().nonnegative(),
      cacheWrite1h: z.number().finite().nonnegative(),
    })
    .optional(),
});

const tableSchema = z.object({
  source: z.string(),
  date: z.string(),
  prices: z.record(z.string(), modelPriceSchema),
});

const liteLlmRecordSchema = z
  .object({
    input_cost_per_token: z.number().finite().nonnegative().optional(),
    output_cost_per_token: z.number().finite().nonnegative().optional(),
    cache_read_input_token_cost: z.number().finite().nonnegative().optional(),
    cache_creation_input_token_cost: z
      .number()
      .finite()
      .nonnegative()
      .optional(),
    cache_creation_input_token_cost_above_1hr: z
      .number()
      .finite()
      .nonnegative()
      .optional(),
  })
  .passthrough();

const BUNDLED_TABLE = tableSchema.parse(bundledPrices);
const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
let defaultFetchCache: Promise<Record<string, ModelPrice> | null> | undefined;
const customFetchCache = new WeakMap<
  typeof fetch,
  Promise<Record<string, ModelPrice> | null>
>();

export type LoadPricesOptions = {
  overridePath?: string;
  fetchLatest?: boolean;
  fetchImpl?: typeof fetch;
};

export async function loadPrices(
  options: LoadPricesOptions = {},
): Promise<PriceTable> {
  let prices: Record<string, ModelPrice> = { ...BUNDLED_TABLE.prices };

  if (options.fetchLatest) {
    const fetched = await getLatestPrices(options.fetchImpl ?? fetch);
    if (fetched) prices = { ...prices, ...fetched };
  }

  if (options.overridePath) {
    try {
      const json: unknown = JSON.parse(
        await readFile(options.overridePath, 'utf8'),
      );
      const override = tableSchema.safeParse(json);
      if (override.success) prices = { ...prices, ...override.data.prices };
    } catch {
      // Missing or malformed optional overrides leave the usable defaults intact.
    }
  }

  return { ...BUNDLED_TABLE, prices };
}

export function resolvePrice(
  table: PriceTable,
  model: string,
): ResolvedPrice | null {
  const direct = table.prices[model];
  if (direct) return { price: direct, matchedAs: model, exact: true };

  const dateStripped = model.replace(/-\d{8}$/, '');
  const dateMatch = table.prices[dateStripped];
  if (dateMatch)
    return { price: dateMatch, matchedAs: dateStripped, exact: false };

  const prefixStripped = stripProviderPrefix(dateStripped);
  const prefixMatch = table.prices[prefixStripped];
  if (prefixMatch)
    return { price: prefixMatch, matchedAs: prefixStripped, exact: false };

  const family = getFamily(prefixStripped);
  if (!family) return null;
  const latest = Object.entries(table.prices)
    .filter(
      ([key]) =>
        getFamily(stripProviderPrefix(key.replace(/-\d{8}$/, ''))) === family,
    )
    .sort(([a], [b]) => compareModelVersion(b, a))[0];
  if (!latest) return null;
  return { price: latest[1], matchedAs: latest[0], exact: false };
}

export function costOf(usage: Usage, price: ModelPrice): number {
  const write1h = usage.cacheCreation1h ?? 0;
  const write5m =
    usage.cacheCreation5m ?? Math.max(0, (usage.cacheCreation ?? 0) - write1h);
  const promptTokens =
    (usage.input ?? 0) + (usage.cacheRead ?? 0) + write5m + write1h;
  const rates =
    price.longContext && promptTokens > price.longContext.thresholdTokens
      ? price.longContext
      : price;
  return (
    ((usage.input ?? 0) * rates.input +
      (usage.output ?? 0) * rates.output +
      (usage.cacheRead ?? 0) * rates.cacheRead +
      write5m * rates.cacheWrite5m +
      write1h * rates.cacheWrite1h) /
    1_000_000
  );
}

async function getLatestPrices(
  fetchImpl: typeof fetch,
): Promise<Record<string, ModelPrice> | null> {
  const isDefault = fetchImpl === fetch;
  const cached = isDefault
    ? defaultFetchCache
    : customFetchCache.get(fetchImpl);
  if (cached) return cached;

  const promise = fetchLatestPrices(fetchImpl);
  if (isDefault) defaultFetchCache = promise;
  else customFetchCache.set(fetchImpl, promise);
  const result = await promise;
  if (result === null) {
    if (isDefault && defaultFetchCache === promise)
      defaultFetchCache = undefined;
    else if (!isDefault && customFetchCache.get(fetchImpl) === promise)
      customFetchCache.delete(fetchImpl);
  }
  return result;
}

async function fetchLatestPrices(
  fetchImpl: typeof fetch,
): Promise<Record<string, ModelPrice> | null> {
  try {
    const response = await fetchImpl(LITELLM_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (typeof json !== 'object' || json === null || Array.isArray(json))
      return null;

    const prices: Record<string, ModelPrice> = {};
    for (const [key, value] of Object.entries(json)) {
      if (!key.startsWith('claude-') && !key.startsWith('anthropic/claude-'))
        continue;
      const modelName = normalizeLiteLlmModelKey(key);
      const record = liteLlmRecordSchema.safeParse(value);
      if (!modelName || !record.success) continue;
      const item = record.data;
      if (
        item.input_cost_per_token === undefined ||
        item.output_cost_per_token === undefined
      )
        continue;
      prices[modelName] = {
        input: item.input_cost_per_token * 1_000_000,
        output: item.output_cost_per_token * 1_000_000,
        cacheRead:
          (item.cache_read_input_token_cost ??
            item.input_cost_per_token * 0.1) * 1_000_000,
        cacheWrite5m:
          (item.cache_creation_input_token_cost ??
            item.input_cost_per_token * 1.25) * 1_000_000,
        cacheWrite1h:
          (item.cache_creation_input_token_cost_above_1hr ??
            item.input_cost_per_token * 2) * 1_000_000,
      };
    }
    return prices;
  } catch {
    return null;
  }
}

function normalizeLiteLlmModelKey(key: string): string | null {
  let model = key;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of [
      'anthropic/',
      'bedrock/',
      'us.anthropic.',
      'anthropic.',
    ]) {
      if (model.startsWith(prefix)) {
        model = model.slice(prefix.length);
        stripped = true;
        break;
      }
    }
  }
  if (!model.startsWith('claude-')) return null;
  // Keep provider versions such as -v1:0 out of the key; the model id remains resolvable.
  return model.replace(/-v\d+:\d+$/, '');
}

function stripProviderPrefix(model: string): string {
  if (model.startsWith('anthropic/')) return model.slice('anthropic/'.length);
  if (model.startsWith('bedrock/')) return model.slice('bedrock/'.length);
  if (model.startsWith('us.anthropic.'))
    return model.slice('us.anthropic.'.length);
  if (model.startsWith('anthropic.')) return model.slice('anthropic.'.length);
  return model;
}

function getFamily(model: string): string | null {
  const bare = /^(opus|sonnet|haiku|fable|mythos)$/.exec(model);
  if (bare) return bare[1] ?? null;
  const current = /^claude-(opus|sonnet|haiku|fable|mythos)(?:-|$)/.exec(model);
  if (current) return current[1] ?? null;
  if (/^claude-3-5-haiku(?:-|$)/.test(model)) return 'haiku';
  if (/^claude-3-opus(?:-|$)/.test(model)) return 'opus';
  return null;
}

function compareModelVersion(a: string, b: string): number {
  const getVersion = (model: string): number[] => {
    const normalized = stripProviderPrefix(model);
    const match = /^claude-(?:opus|sonnet|haiku|fable|mythos)-(.+)$/.exec(
      normalized,
    );
    const legacy = /^claude-(3-5-haiku|3-opus)(?:-(.*))?$/.exec(normalized);
    const version = match?.[1] ?? legacy?.[1] ?? '';
    return version
      .split('-')
      .filter((part) => /^\d+$/.test(part))
      .map(Number);
  };
  const aVersion = getVersion(a);
  const bVersion = getVersion(b);
  for (
    let index = 0;
    index < Math.max(aVersion.length, bVersion.length);
    index += 1
  ) {
    const difference = (aVersion[index] ?? -1) - (bVersion[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

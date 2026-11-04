import { join } from 'node:path';
import { redactText } from '../redact/index.js';
import {
  clean,
  readJson,
  record,
  type JsonRecord,
  type Scope,
  type SettingsLayer,
  type Source,
} from './shared.js';

export async function readSettings(
  claudeDir: string,
  projectPath?: string,
): Promise<SettingsLayer[]> {
  const files: [string, Scope][] = [
    [join(claudeDir, 'settings.json'), 'user'],
    [join(claudeDir, 'settings.local.json'), 'user'],
  ];
  if (projectPath)
    files.push(
      [join(projectPath, '.claude/settings.json'), 'project'],
      [join(projectPath, '.claude/settings.local.json'), 'local'],
    );
  const result: SettingsLayer[] = [];
  for (const [path, scope] of files) {
    const data = await readJson(path, {
      roots: [claudeDir, ...(projectPath ? [projectPath] : [])],
    });
    if (data) result.push({ data, source: { path, scope } });
  }
  return clean(result);
}

export interface MergedSettings {
  effective: JsonRecord;
  provenance: Record<string, Scope | 'mixed'>;
}
const settingSources = new WeakMap<JsonRecord, Record<string, Source>>();
export function settingSource(
  settings: JsonRecord,
  pointer: string,
): Source | undefined {
  return settingSources.get(settings)?.[pointer];
}
const priority: Record<Scope, number> = {
  user: 0,
  plugin: 0,
  project: 1,
  local: 2,
};
const pointerKey = (key: string): string =>
  key.replaceAll('~', '~0').replaceAll('/', '~1');

export function mergeSettings(
  layers: readonly SettingsLayer[],
): MergedSettings {
  const provenance: Record<string, Scope | 'mixed'> = {};
  const sources: Record<string, Source> = {};
  function merge(
    base: JsonRecord,
    next: JsonRecord,
    pointer: string,
    source: Source,
  ): JsonRecord {
    const { scope } = source;
    const result = { ...base };
    for (const [key, value] of Object.entries(next)) {
      const path = `${pointer}/${pointerKey(key)}`;
      const previous = result[key];
      const isObject =
        value !== null && typeof value === 'object' && !Array.isArray(value);
      const concatenate =
        /^\/permissions\/(allow|deny|ask)$/.test(path) && Array.isArray(value);
      if (!isObject && !concatenate) {
        for (const old of Object.keys(provenance)) {
          if (old.startsWith(`${path}/`)) {
            delete provenance[old];
            delete sources[old];
          }
        }
      } else if (
        isObject &&
        !(
          previous !== null &&
          typeof previous === 'object' &&
          !Array.isArray(previous)
        )
      ) {
        for (const old of Object.keys(provenance))
          if (old.startsWith(`${path}/`)) {
            delete provenance[old];
            delete sources[old];
          }
      }
      if (isObject)
        result[key] = merge(record(previous), record(value), path, source);
      else if (concatenate && Array.isArray(value)) {
        const all = [...(Array.isArray(previous) ? previous : []), ...value];
        result[key] = all.filter(
          (entry, index) =>
            all.findIndex(
              (other) => JSON.stringify(other) === JSON.stringify(entry),
            ) === index,
        );
      } else result[key] = value;
      provenance[path] = scope;
      sources[path] = source;
      if (Array.isArray(result[key])) {
        (result[key] as unknown[]).forEach((_entry, index) => {
          provenance[`${path}/${index}`] ??= scope;
          sources[`${path}/${index}`] ??= source;
        });
      }
    }
    return result;
  }
  let effective: JsonRecord = {};
  for (const layer of [...layers].sort(
    (a, b) => priority[a.source.scope] - priority[b.source.scope],
  )) {
    effective = merge(effective, layer.data, '', layer.source);
  }
  // Derive container provenance from the final children, after all replacements.
  function containers(value: unknown, pointer: string): void {
    if (value === null || typeof value !== 'object') return;
    const children = Object.entries(value);
    for (const [key, child] of children)
      containers(child, `${pointer}/${pointerKey(key)}`);
    const scopes = new Set(
      children
        .map(([key]) => provenance[`${pointer}/${pointerKey(key)}`])
        .filter(Boolean),
    );
    if (pointer && scopes.size) {
      provenance[pointer] = scopes.size === 1 ? [...scopes][0]! : 'mixed';
      if (provenance[pointer] === 'mixed') delete sources[pointer];
    }
  }
  containers(effective, '');
  effective = clean(effective);
  settingSources.set(
    effective,
    Object.fromEntries(
      Object.entries(sources).map(([pointer, source]) => [
        redactText(pointer),
        source,
      ]),
    ),
  );
  return {
    effective,
    provenance: Object.fromEntries(
      Object.entries(provenance).map(([pointer, scope]) => [
        redactText(pointer),
        scope,
      ]),
    ),
  };
}

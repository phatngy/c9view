import {
  clean,
  record,
  type JsonRecord,
  type Scope,
  type Source,
} from './shared.js';
import { settingSource, type MergedSettings } from './settings.js';

export interface Hook {
  event: string;
  matcher?: string;
  type: string;
  command?: string;
  url?: string;
  timeout?: number;
  source: Source;
}
/** Pass merged settings to retain scope provenance; plain settings default to user scope. */
export function readHooks(
  settings: JsonRecord | MergedSettings,
  source?: Source,
): Hook[] {
  const merged = 'effective' in settings && 'provenance' in settings;
  const effective = merged ? (settings.effective as JsonRecord) : settings;
  const provenance = merged ? record(settings.provenance) : {};
  const result: Hook[] = [];
  for (const [event, groups] of Object.entries(record(effective.hooks))) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, index) => {
      const entry = record(group);
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : [entry];
      for (const value of hooks) {
        const hook = record(value);
        if (typeof hook.type !== 'string') continue;
        const pointer = `/hooks/${event.replaceAll('~', '~0').replaceAll('/', '~1')}/${index}`;
        const scope = (provenance[pointer] ??
          provenance[pointer.slice(0, pointer.lastIndexOf('/'))] ??
          'user') as Scope;
        result.push({
          event,
          type: hook.type,
          ...(typeof entry.matcher === 'string'
            ? { matcher: entry.matcher }
            : {}),
          ...(typeof hook.command === 'string'
            ? { command: hook.command }
            : {}),
          ...(typeof hook.url === 'string' ? { url: hook.url } : {}),
          ...(typeof hook.timeout === 'number'
            ? { timeout: hook.timeout }
            : {}),
          source: source ??
            settingSource(effective, pointer) ??
            settingSource(
              effective,
              `/hooks/${event.replaceAll('~', '~0').replaceAll('/', '~1')}`,
            ) ?? { scope, path: '' },
        });
      }
    });
  }
  return clean(result);
}

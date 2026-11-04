import { join } from 'node:path';
import {
  HookEventTailer,
  decideStatus,
  hooksInstalled,
  hookStateDir,
} from '@c9view/core';
import type { SessionStatus, StatusHistoryResponse } from '@c9view/api';

export class HookEvents {
  readonly tailer: HookEventTailer;
  private readonly listeners = new Set<() => void>();
  onUpdate(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private until = 0;
  private flight: Promise<void> | undefined;
  private changes = new Map<string, StatusHistoryResponse['changes']>();
  constructor(stateDir = hookStateDir()) {
    this.tailer = new HookEventTailer(stateDir);
    const timer = setInterval(() => {
      void this.refresh().catch(() => {});
    }, 1000);
    timer.unref();
    this.close = () => clearInterval(timer);
  }
  readonly close: () => void;
  /** Coalesce requests and the background poll. */
  async refresh() {
    if (this.flight) return this.flight;
    if (Date.now() < this.until) return;
    const previous = new Map(this.tailer.sessions);
    this.flight = this.tailer
      .refresh()
      .then(() => {
        this.until = Date.now() + 1000;
        if (
          [...this.tailer.sessions].some(
            ([id, events]) => previous.get(id) !== events,
          )
        )
          for (const listener of this.listeners) listener();
      })
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  events(sessionId: string) {
    return this.tailer.sessions.get(sessionId) ?? [];
  }
  record(sessionId: string, status: SessionStatus) {
    const changes = this.changes.get(sessionId) ?? [];
    const previous = changes.at(-1);
    if (
      !previous ||
      previous.column !== status.column ||
      previous.source !== status.source
    ) {
      changes.push({
        at: new Date().toISOString(),
        column: status.column,
        reason: status.reason,
        source: status.source,
      });
      this.changes.delete(sessionId);
      this.changes.set(sessionId, changes.slice(-200));
      while (this.changes.size > 2000)
        this.changes.delete(this.changes.keys().next().value!);
    }
  }
  history(sessionId: string): StatusHistoryResponse {
    const events = this.events(sessionId);
    const changes: StatusHistoryResponse['changes'] = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      const status = decideStatus({
        now: Date.parse(event.ts),
        liveAlive: true,
        hookEvents: events.slice(0, i + 1),
        transcript: {},
      });
      if (status.source === 'hook' && status.observedAt === event.ts)
        changes.push({
          at: event.ts,
          column: status.column,
          reason: status.reason,
          source: status.source,
        });
    }
    changes.push(...(this.changes.get(sessionId) ?? []));
    changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      changes: changes
        .filter(
          (change, i) =>
            i === 0 ||
            change.column !== changes[i - 1]?.column ||
            change.source !== changes[i - 1]?.source,
        )
        .slice(-200),
    };
  }
  async health(claudeDir: string) {
    await this.refresh();
    return {
      installed: await hooksInstalled(claudeDir),
      eventsFile: join(this.tailer.stateDir, 'events.jsonl'),
      lastEventAt: this.tailer.lastEventAt,
    };
  }
}

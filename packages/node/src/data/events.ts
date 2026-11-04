import type { LiveEvent } from '@c9view/api';

export class EventHub {
  readonly listeners = new Set<(event: LiveEvent) => void>();
  emit(event: LiveEvent) {
    for (const listener of this.listeners) listener(event);
  }
  subscribe(listener: (event: LiveEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

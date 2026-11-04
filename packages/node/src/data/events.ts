import type { LiveEvent, ControlEvent } from '@c9view/api';

type ControlLiveEvent = ControlEvent extends infer E
  ? E extends { type: infer T }
    ? { event: T; data: Omit<E, 'type'> }
    : never
  : never;
export type NodeLiveEvent = LiveEvent | ControlLiveEvent;

export class EventHub {
  readonly listeners = new Set<(event: NodeLiveEvent) => void>();
  emit(event: NodeLiveEvent) {
    for (const listener of this.listeners) listener(event);
  }
  subscribe(listener: (event: NodeLiveEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

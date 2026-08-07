/**
 * Minimal typed event bus.
 *
 * Events are described by a map type where each key is an event name and its
 * value is the payload type:
 *
 * ```ts
 * interface Events { 'money:changed': { amount: number } }
 * const bus = new EventBus<Events>();
 * bus.on('money:changed', (p) => console.log(p.amount));
 * ```
 */
export type EventMap = Record<string, unknown>;

/** Handler for a single event payload. */
export type EventHandler<T> = (payload: T) => void;

export class EventBus<M extends EventMap> {
  private readonly handlers = new Map<keyof M, Set<EventHandler<never>>>();

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function.
   */
  on<K extends keyof M>(event: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  /** Unsubscribe a previously registered handler. */
  off<K extends keyof M>(event: K, handler: EventHandler<M[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  /** Subscribe to an event for a single emission. */
  once<K extends keyof M>(event: K, handler: EventHandler<M[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /** Emit an event to all current subscribers. */
  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const handler of [...set]) (handler as EventHandler<M[K]>)(payload);
  }

  /** Remove all handlers for one event, or for every event when omitted. */
  clear(event?: keyof M): void {
    if (event === undefined) this.handlers.clear();
    else this.handlers.delete(event);
  }
}

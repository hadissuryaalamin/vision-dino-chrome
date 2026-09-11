import type { Listener, Unsubscribe } from "../../src/shared";

/**
 * Minimal listener list for the fakes, kept separate from the code under test so the fakes
 * cannot inherit its bugs. Listeners run synchronously in subscription order; subscribing
 * the same function twice creates two subscriptions; unsubscribe is idempotent and takes
 * effect immediately, even during an emit.
 */
export class ListenerList<T> {
  private entries: { readonly listener: Listener<T>; active: boolean }[] = [];

  get size(): number {
    return this.entries.length;
  }

  add(listener: Listener<T>): Unsubscribe {
    const entry = { listener, active: true };
    this.entries.push(entry);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      this.entries = this.entries.filter((candidate) => candidate !== entry);
    };
  }

  emit(value: T): void {
    for (const entry of [...this.entries]) {
      if (entry.active) entry.listener(value);
    }
  }
}

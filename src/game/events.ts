import type { Listener, Unsubscribe } from "../shared";

/** Receives errors thrown by listeners, so one faulty listener cannot corrupt a step. */
export type ListenerErrorHandler = (error: unknown) => void;

/**
 * Default ListenerErrorHandler: rethrow asynchronously, so the error is still reported
 * (console, window "error" event) but the emitting code finishes its work.
 */
export function rethrowAsync(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

/** @internal Synchronous listener list with idempotent unsubscribe. */
export interface Emitter<T> {
  subscribe(listener: Listener<T>): Unsubscribe;
  emit(value: T): void;
  clear(): void;
  readonly listenerCount: number;
}

interface Subscription<T> {
  readonly listener: Listener<T>;
  active: boolean;
}

/**
 * @internal Listeners run synchronously in subscription order. A listener removed during an
 * emit is not called afterwards; one added during an emit is first called on the next emit.
 */
export function createEmitter<T>(onError: ListenerErrorHandler = rethrowAsync): Emitter<T> {
  let subscriptions: Subscription<T>[] = [];

  return {
    subscribe(listener) {
      const subscription: Subscription<T> = { listener, active: true };
      subscriptions = [...subscriptions, subscription];
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        subscriptions = subscriptions.filter((s) => s !== subscription);
      };
    },
    emit(value) {
      for (const subscription of subscriptions) {
        if (!subscription.active) continue;
        try {
          subscription.listener(value);
        } catch (error) {
          onError(error);
        }
      }
    },
    clear() {
      for (const subscription of subscriptions) subscription.active = false;
      subscriptions = [];
    },
    get listenerCount() {
      return subscriptions.length;
    },
  };
}

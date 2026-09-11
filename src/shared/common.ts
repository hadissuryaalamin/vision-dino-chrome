/**
 * Milliseconds on the `performance.now()` clock (a DOMHighResTimeStamp).
 * `KeyboardEvent.timeStamp`, `requestAnimationFrame` and `requestVideoFrameCallback`
 * use the same time origin, so timestamps from different input sources are comparable.
 */
export type TimestampMs = number;

/** Removes a previously registered listener. Calling it more than once is a no-op. */
export type Unsubscribe = () => void;

export type Listener<T> = (value: T) => void;

/** Compile-time exhaustiveness check for discriminated unions. */
export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

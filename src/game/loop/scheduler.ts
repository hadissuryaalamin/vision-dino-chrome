/** Like requestAnimationFrame: calls back with a performance.now()-based timestamp. */
export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

/** The production scheduler: `requestAnimationFrame` / `cancelAnimationFrame`. */
export function createAnimationFrameScheduler(): FrameScheduler {
  return {
    request: (callback) => globalThis.requestAnimationFrame(callback),
    cancel: (handle) => globalThis.cancelAnimationFrame(handle),
  };
}

/** A FrameScheduler driven by hand, for tests and tools. */
export interface ManualFrameScheduler extends FrameScheduler {
  /** Callbacks requested and not yet run or cancelled. */
  readonly pendingCount: number;
  /**
   * Run every callback that was pending when tick() was called, with `timestampMs`.
   * Callbacks requested during the tick wait for the next tick, like requestAnimationFrame.
   */
  tick(timestampMs: number): void;
}

export function createManualFrameScheduler(): ManualFrameScheduler {
  let nextHandle = 1;
  let pending = new Map<number, (timestampMs: number) => void>();

  return {
    request(callback) {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      pending.delete(handle);
    },
    get pendingCount() {
      return pending.size;
    },
    tick(timestampMs) {
      const due = pending;
      pending = new Map();
      for (const callback of due.values()) callback(timestampMs);
    },
  };
}

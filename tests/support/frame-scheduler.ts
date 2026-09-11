/**
 * A requestAnimationFrame stand-in stepped by the test. Structurally compatible with the
 * app's frame-scheduler dependency and with src/game's FrameScheduler.
 */
export class ManualFrameScheduler {
  now = 0;
  private nextHandle = 1;
  private readonly callbacks = new Map<number, (timestampMs: number) => void>();

  get pendingCount(): number {
    return this.callbacks.size;
  }

  request(callback: (timestampMs: number) => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  /** Advance the clock and run every callback requested before this step. */
  step(deltaMs = 16): void {
    this.now += deltaMs;
    const due = [...this.callbacks.entries()];
    this.callbacks.clear();
    for (const [, callback] of due) callback(this.now);
  }
}

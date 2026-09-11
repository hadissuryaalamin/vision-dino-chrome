import type {
  Listener,
  PlayerAction,
  PlayerActionSource,
  PlayerId,
  PlayerInputSource,
  TimestampMs,
  Unsubscribe,
} from "../../src/shared";
import { ListenerList } from "./listeners";

/**
 * A PlayerInputSource driven by the test. Like a real source it only emits between
 * `start()` and `stop()`; `emit` returns whether the action was delivered.
 */
export class FakeInputSource implements PlayerInputSource {
  startCalls = 0;
  stopCalls = 0;
  running = false;
  /** Options the factory was called with, when created through a factory. */
  readonly options: unknown;
  private readonly listeners = new ListenerList<PlayerAction>();

  constructor(options?: unknown) {
    this.options = options;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  start(): void {
    this.startCalls += 1;
    this.running = true;
  }

  stop(): void {
    this.stopCalls += 1;
    this.running = false;
  }

  subscribe(listener: Listener<PlayerAction>): Unsubscribe {
    return this.listeners.add(listener);
  }

  emit(action: PlayerAction): boolean {
    if (!this.running) return false;
    this.listeners.emit(action);
    return true;
  }

  jump(
    playerId: PlayerId,
    source: PlayerActionSource = "keyboard",
    timestamp: TimestampMs = 0,
  ): boolean {
    return this.emit({ type: "jump", playerId, source, timestamp });
  }
}

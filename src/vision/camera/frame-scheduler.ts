import type { TimestampMs } from "../../shared";
import type { VideoFrameScheduler } from "../types";

/** requestAnimationFrame seam for the fallback path. */
export interface AnimationFrameApi {
  request(callback: (timestampMs: TimestampMs) => void): number;
  cancel(handle: number): void;
}

const HAVE_CURRENT_DATA = 2;
/** A capture time older than this relative to the callback is ignored (clock mismatch). */
const MAX_CAPTURE_AGE_MS = 1000;

/**
 * Timestamp of a video frame: the camera capture time when the browser reports a plausible
 * one (so gesture latency includes the camera pipeline), else the callback time. Both are on
 * the performance.now() clock.
 */
export function videoFrameTimestamp(
  now: TimestampMs,
  metadata: { readonly captureTime?: number },
): TimestampMs {
  const capture = metadata.captureTime;
  return typeof capture === "number" &&
    Number.isFinite(capture) &&
    capture <= now &&
    now - capture < MAX_CAPTURE_AGE_MS
    ? capture
    : now;
}

function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return (
    typeof (video as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback ===
    "function"
  );
}

function browserAnimationFrames(): AnimationFrameApi {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => {
      cancelAnimationFrame(handle);
    },
  };
}

/**
 * Production frame scheduler: `requestVideoFrameCallback` (one callback per presented frame),
 * falling back to `requestAnimationFrame` polling that only reports a frame when the video's
 * `currentTime` has changed.
 */
export function createVideoFrameScheduler(
  animationFrames: AnimationFrameApi = browserAnimationFrames(),
): VideoFrameScheduler {
  const lastMediaTime = new WeakMap<HTMLVideoElement, number>();
  return {
    request(video, callback) {
      if (supportsVideoFrameCallback(video)) {
        const handle = video.requestVideoFrameCallback((now, metadata) => {
          callback(videoFrameTimestamp(now, metadata));
        });
        return () => {
          video.cancelVideoFrameCallback(handle);
        };
      }
      let cancelled = false;
      let handle = 0;
      const tick = (now: TimestampMs): void => {
        if (cancelled) return;
        const mediaTime = video.currentTime;
        if (video.readyState >= HAVE_CURRENT_DATA && mediaTime !== lastMediaTime.get(video)) {
          lastMediaTime.set(video, mediaTime);
          callback(now);
          return;
        }
        handle = animationFrames.request(tick);
      };
      handle = animationFrames.request(tick);
      return () => {
        cancelled = true;
        animationFrames.cancel(handle);
      };
    },
  };
}

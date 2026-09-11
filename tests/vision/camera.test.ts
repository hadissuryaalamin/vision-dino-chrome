import { describe, expect, it } from "vitest";
import type { VisionErrorCode } from "../../src/shared";
import {
  CameraError,
  RELAXED_CAMERA_CONSTRAINTS,
  buildCameraConstraints,
  createCameraAdapter,
  mapCameraError,
} from "../../src/vision/camera/camera";
import {
  createVideoFrameScheduler,
  videoFrameTimestamp,
  type AnimationFrameApi,
} from "../../src/vision/camera/frame-scheduler";
import { checkCameraSupport, isCameraSupported } from "../../src/vision/camera/support";
import { DEFAULT_VISION_CONFIG } from "../../src/vision/config";
import type { CameraAdapter } from "../../src/vision/types";
import {
  FakeMediaDevices,
  FakeVideoElement,
  asMediaDevices,
  asVideo,
  type GetUserMediaBehavior,
} from "./fixtures";

function adapter(devices: FakeMediaDevices | undefined, secure = true): CameraAdapter {
  return createCameraAdapter({
    getMediaDevices: () => (devices ? asMediaDevices(devices) : undefined),
    isSecureContext: () => secure,
    camera: DEFAULT_VISION_CONFIG.camera,
  });
}

async function openError(camera: CameraAdapter): Promise<CameraError> {
  try {
    await camera.open();
  } catch (error) {
    if (error instanceof CameraError) return error;
    throw error;
  }
  throw new Error("expected open() to reject");
}

describe("camera adapter", () => {
  it("requests the front camera at ideal 1280×720, 30 fps, without audio", async () => {
    const devices = new FakeMediaDevices();
    await adapter(devices).open();
    expect(devices.calls).toEqual([buildCameraConstraints(DEFAULT_VISION_CONFIG.camera)]);
    expect(devices.calls[0]).toEqual({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
  });

  it.each<[string, VisionErrorCode]>([
    ["NotAllowedError", "camera-permission-denied"],
    ["SecurityError", "camera-permission-denied"],
    ["NotFoundError", "camera-not-found"],
    ["NotReadableError", "camera-in-use"],
    ["AbortError", "camera-in-use"],
    ["SomethingElseError", "unknown"],
  ])("maps %s to %s", async (name, code) => {
    const devices = new FakeMediaDevices();
    devices.behaviors = [{ reject: name }];
    const error = await openError(adapter(devices));
    expect(error.visionError.code).toBe(code);
    expect(error.visionError.message).toContain(name);
    expect(devices.calls).toHaveLength(1);
  });

  it.each<[string, GetUserMediaBehavior[], VisionErrorCode | "ok"]>([
    ["succeeds on the relaxed retry", [{ reject: "OverconstrainedError" }, "grant"], "ok"],
    [
      "reports not-found when the retry is overconstrained too",
      [{ reject: "OverconstrainedError" }, { reject: "OverconstrainedError" }],
      "camera-not-found",
    ],
    [
      "maps the retry's own error",
      [{ reject: "OverconstrainedError" }, { reject: "NotAllowedError" }],
      "camera-permission-denied",
    ],
  ])("after OverconstrainedError, %s", async (_label, behaviors, expected) => {
    const devices = new FakeMediaDevices();
    devices.behaviors = [...behaviors];
    const camera = adapter(devices);
    if (expected === "ok") {
      await expect(camera.open()).resolves.toBeDefined();
    } else {
      expect((await openError(camera)).visionError.code).toBe(expected);
    }
    expect(devices.calls).toHaveLength(2);
    expect(devices.calls[1]).toEqual(RELAXED_CAMERA_CONSTRAINTS);
  });

  it("reports camera-unsupported without an API or outside a secure context", async () => {
    expect((await openError(adapter(undefined))).visionError.code).toBe("camera-unsupported");
    const devices = new FakeMediaDevices();
    expect((await openError(adapter(devices, false))).visionError.code).toBe("camera-unsupported");
    expect(devices.calls).toHaveLength(0);
  });

  it("stops every track on close, idempotently, and when reopened", async () => {
    const devices = new FakeMediaDevices();
    const camera = adapter(devices);
    await camera.open();
    await camera.open();
    expect(devices.streams[0]?.allStopped).toBe(true);
    expect(devices.streams[1]?.allStopped).toBe(false);
    camera.close();
    camera.close();
    expect(devices.streams[1]?.allStopped).toBe(true);
    expect(devices.streams[1]?.tracks[0]?.stopCount).toBe(1);
  });

  it("stops a stream that arrives after close()", async () => {
    const devices = new FakeMediaDevices();
    devices.behaviors = ["defer"];
    const camera = adapter(devices);
    const opening = openError(camera);
    camera.close();
    devices.releaseDeferred();
    expect((await opening).visionError.code).toBe("unknown");
    expect(devices.streams[0]?.allStopped).toBe(true);
  });

  it("describes non-Error rejections", () => {
    expect(mapCameraError("nope")).toEqual({ code: "unknown", message: "nope" });
    expect(mapCameraError(undefined)).toEqual({ code: "unknown", message: "Unknown error" });
  });
});

describe("camera support", () => {
  it("requires getUserMedia and a secure context", () => {
    const getUserMedia = (): undefined => undefined;
    expect(
      checkCameraSupport({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia } } }),
    ).toBe(true);
    expect(
      checkCameraSupport({ isSecureContext: false, navigator: { mediaDevices: { getUserMedia } } }),
    ).toBe(false);
    expect(checkCameraSupport({ isSecureContext: true, navigator: {} })).toBe(false);
    expect(checkCameraSupport({})).toBe(false);
  });

  it("is false in the Node test environment", () => {
    expect(isCameraSupported()).toBe(false);
  });
});

describe("video frame scheduler", () => {
  it("uses requestVideoFrameCallback and the capture time when plausible", () => {
    let stored: VideoFrameRequestCallback | null = null;
    const cancelled: number[] = [];
    const video = {
      requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
        stored = callback;
        return 7;
      },
      cancelVideoFrameCallback(handle: number) {
        cancelled.push(handle);
      },
    } as unknown as HTMLVideoElement;
    const received: number[] = [];
    const cancel = createVideoFrameScheduler().request(video, (t) => received.push(t));
    const callback = stored as VideoFrameRequestCallback | null;
    callback?.(100, { captureTime: 80 } as VideoFrameCallbackMetadata);
    expect(received).toEqual([80]);
    cancel();
    expect(cancelled).toEqual([7]);
  });

  it("falls back to the callback time for missing or implausible capture times", () => {
    expect(videoFrameTimestamp(100, {})).toBe(100);
    expect(videoFrameTimestamp(100, { captureTime: 120 })).toBe(100);
    expect(videoFrameTimestamp(5000, { captureTime: 1000 })).toBe(5000);
    expect(videoFrameTimestamp(100, { captureTime: 90 })).toBe(90);
  });

  it("falls back to animation frames that report only new video frames", () => {
    let queue: ((t: number) => void)[] = [];
    const cancelledHandles: number[] = [];
    const animation: AnimationFrameApi = {
      request(callback) {
        queue.push(callback);
        return queue.length;
      },
      cancel(handle) {
        cancelledHandles.push(handle);
      },
    };
    const flush = (t: number): void => {
      const due = queue;
      queue = [];
      for (const callback of due) callback(t);
    };
    const fake = new FakeVideoElement();
    const scheduler = createVideoFrameScheduler(animation);
    const received: number[] = [];

    scheduler.request(asVideo(fake), (t) => received.push(t));
    flush(10);
    expect(received).toEqual([10]);

    scheduler.request(asVideo(fake), (t) => received.push(t));
    flush(20); // same currentTime: keeps waiting
    expect(received).toEqual([10]);
    fake.currentTime = 0.033;
    fake.readyState = 1; // no data yet
    flush(30);
    expect(received).toEqual([10]);
    fake.readyState = 4;
    flush(40);
    expect(received).toEqual([10, 40]);

    const cancel = scheduler.request(asVideo(fake), (t) => received.push(t));
    cancel();
    fake.currentTime = 0.066;
    flush(50);
    expect(received).toEqual([10, 40]);
    expect(cancelledHandles).toHaveLength(1);
  });
});

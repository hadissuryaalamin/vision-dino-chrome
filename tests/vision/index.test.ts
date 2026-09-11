import { describe, expect, expectTypeOf, it } from "vitest";
import type { VisionSessionFactory } from "../../src/shared";
import { DEFAULT_VISION_CONFIG, createVisionSession, isCameraSupported } from "../../src/vision";
import { modelAssetUrl } from "../../src/vision/landmarks/loader";
import { FakeVideoElement, asVideo } from "./fixtures";

describe("vision public API", () => {
  it("matches the shared factory contract", () => {
    expectTypeOf(createVisionSession).toEqualTypeOf<VisionSessionFactory>();
    expectTypeOf(isCameraSupported).toEqualTypeOf<() => boolean>();
    expect(Object.isFrozen(DEFAULT_VISION_CONFIG)).toBe(true);
  });

  it("creates an idle session and fails cleanly where the camera is unsupported", async () => {
    const video = new FakeVideoElement();
    const session = createVisionSession({ video: asVideo(video), mirrored: true });
    expect(session.getStatus()).toBe("idle");
    expect(session.getDiagnostics()).toMatchObject({
      status: "idle",
      mirrored: true,
      facesDetected: 0,
    });
    // Node is not a secure context and has no mediaDevices.
    expect(isCameraSupported()).toBe(false);
    const result = await session.start();
    expect(result).toMatchObject({ ok: false, error: { code: "camera-unsupported" } });
    expect(session.getStatus()).toBe("error");
    await session.dispose();
  });

  it("builds the self-hosted model URL from the base URL", () => {
    expect(modelAssetUrl("./", "https://example.github.io/vision-dino-chrome/")).toBe(
      "https://example.github.io/vision-dino-chrome/vision/face_landmarker.task",
    );
    expect(modelAssetUrl("/", "http://localhost:5173/src/vision/lab/")).toBe(
      "http://localhost:5173/vision/face_landmarker.task",
    );
    expect(modelAssetUrl("/base", "https://example.com/base/")).toBe(
      "https://example.com/base/vision/face_landmarker.task",
    );
  });
});

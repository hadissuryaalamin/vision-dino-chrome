// Synthetic fixtures and fakes for vision tests. No camera, no model, no network, and no
// import of @mediapipe/tasks-vision.
import type { PerPlayer, VisionEvent, VisionSessionOptions } from "../../src/shared";
import { createCameraAdapter } from "../../src/vision/camera/camera";
import {
  DEFAULT_VISION_CONFIG,
  mergeVisionConfig,
  type VisionConfigOverrides,
} from "../../src/vision/config";
import {
  LEFT_EYE,
  MOUTH_CORNERS,
  MOUTH_VERTICAL_PAIRS,
  RIGHT_EYE,
  type EyeIndices,
} from "../../src/vision/gestures/landmark-indices";
import { createVisionSessionWith, type InternalVisionSession } from "../../src/vision/session";
import type {
  BlendshapeScores,
  DetectedFace,
  FrameSize,
  HeadPose,
  LandmarkDetector,
  Point2,
  VideoFrameScheduler,
} from "../../src/vision/types";

export const FRAME_720P: FrameSize = { width: 1280, height: 720 };
export const LANDMARK_COUNT = 478;

/** EAR / MAR values used across tests. */
export const EYES_OPEN = 0.3;
export const EYES_CLOSED = 0.1;
export const MOUTH_CLOSED = 0.05;
export const MOUTH_OPEN = 0.5;

export interface FaceSpec {
  /** Face centre x in camera space (raw frame, normalised). */
  readonly cx: number;
  /** Face centre y (normalised). Default 0.5. */
  readonly cy?: number;
  /** Face width in pixels. Default 200. */
  readonly widthPx?: number;
  readonly frame?: FrameSize;
  /** Eye aspect ratio of both eyes (default EYES_OPEN), or per eye. */
  readonly ear?: number;
  readonly rightEar?: number;
  readonly leftEar?: number;
  /** Mouth aspect ratio. Default MOUTH_CLOSED. */
  readonly mar?: number;
  readonly pose?: HeadPose | null;
  readonly blendshapes?: BlendshapeScores | null;
}

/**
 * Builds a 478-landmark face in camera space whose eye and mouth aspect ratios, measured in
 * pixels, are exactly the requested values. The remaining points lie on an ellipse, so the
 * face bounds are exactly `widthPx` wide.
 */
export function makeFace(spec: FaceSpec): DetectedFace {
  const frame = spec.frame ?? FRAME_720P;
  const width = spec.widthPx ?? 200;
  const height = width * 1.3;
  const cx = spec.cx * frame.width;
  const cy = (spec.cy ?? 0.5) * frame.height;
  const points: Point2[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const angle = (2 * Math.PI * i) / LANDMARK_COUNT;
    points.push({
      x: cx + (width / 2) * Math.cos(angle),
      y: cy + (height / 2) * Math.sin(angle),
    });
  }
  const setEye = (indices: EyeIndices, ex: number, ey: number, ear: number): void => {
    const eyeWidth = 0.2 * width;
    const half = (ear * eyeWidth) / 2;
    const [p1, p2, p3, p4, p5, p6] = indices;
    points[p1] = { x: ex - eyeWidth / 2, y: ey };
    points[p4] = { x: ex + eyeWidth / 2, y: ey };
    points[p2] = { x: ex - eyeWidth / 6, y: ey - half };
    points[p3] = { x: ex + eyeWidth / 6, y: ey - half };
    points[p6] = { x: ex - eyeWidth / 6, y: ey + half };
    points[p5] = { x: ex + eyeWidth / 6, y: ey + half };
  };
  setEye(RIGHT_EYE, cx - 0.2 * width, cy - 0.1 * height, spec.rightEar ?? spec.ear ?? EYES_OPEN);
  setEye(LEFT_EYE, cx + 0.2 * width, cy - 0.1 * height, spec.leftEar ?? spec.ear ?? EYES_OPEN);

  const mouthWidth = 0.4 * width;
  const my = cy + 0.25 * height;
  const gap = (spec.mar ?? MOUTH_CLOSED) * mouthWidth;
  points[MOUTH_CORNERS[0]] = { x: cx - mouthWidth / 2, y: my };
  points[MOUTH_CORNERS[1]] = { x: cx + mouthWidth / 2, y: my };
  MOUTH_VERTICAL_PAIRS.forEach(([upper, lower], pair) => {
    const x = cx + ((pair - 1) * mouthWidth) / 4;
    points[upper] = { x, y: my - gap / 2 };
    points[lower] = { x, y: my + gap / 2 };
  });

  return {
    landmarks: points.map((point) => ({
      x: point.x / frame.width,
      y: point.y / frame.height,
      z: 0,
    })),
    pose: spec.pose ?? null,
    blendshapes: spec.blendshapes ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// DOM fakes

export class FakeVideoElement {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  currentTime = 0;
  readyState = 4;
  videoWidth: number;
  videoHeight: number;
  playCalls = 0;

  constructor(frame: FrameSize = FRAME_720P) {
    this.videoWidth = frame.width;
    this.videoHeight = frame.height;
  }

  play(): Promise<void> {
    this.playCalls++;
    return Promise.resolve();
  }
}

export function asVideo(fake: FakeVideoElement): HTMLVideoElement {
  return fake as unknown as HTMLVideoElement;
}

export class FakeTrack extends EventTarget {
  readonly kind = "video";
  readyState: "live" | "ended" = "live";
  stopCount = 0;

  stop(): void {
    this.stopCount++;
    this.readyState = "ended";
  }

  /** Simulates the device being unplugged. */
  simulateEnded(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

export class FakeStream {
  readonly tracks: FakeTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new FakeTrack());
  }

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks;
  }

  get allStopped(): boolean {
    return this.tracks.every((track) => track.stopCount > 0);
  }
}

/** One scripted getUserMedia outcome: grant, reject with a DOMException name, or wait. */
export type GetUserMediaBehavior = "grant" | "defer" | { readonly reject: string };

export class FakeMediaDevices {
  readonly calls: MediaStreamConstraints[] = [];
  readonly streams: FakeStream[] = [];
  /** Consumed in order; when empty, requests are granted. */
  behaviors: GetUserMediaBehavior[] = [];
  private deferred: ((stream: FakeStream) => void)[] = [];

  readonly getUserMedia = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    this.calls.push(constraints);
    const behavior = this.behaviors.shift() ?? "grant";
    if (behavior === "grant") return Promise.resolve(this.newStream());
    if (behavior === "defer") {
      return new Promise<MediaStream>((resolve) => {
        this.deferred.push((stream) => {
          resolve(stream as unknown as MediaStream);
        });
      });
    }
    return Promise.reject(new DOMException(`fake ${behavior.reject}`, behavior.reject));
  };

  /** Resolves every deferred request with a new stream. */
  releaseDeferred(): void {
    const pending = this.deferred;
    this.deferred = [];
    for (const resolve of pending) resolve(this.newStreamRaw());
  }

  private newStreamRaw(): FakeStream {
    const stream = new FakeStream();
    this.streams.push(stream);
    return stream;
  }

  private newStream(): MediaStream {
    return this.newStreamRaw() as unknown as MediaStream;
  }
}

export function asMediaDevices(fake: FakeMediaDevices): MediaDevices {
  return fake as unknown as MediaDevices;
}

// ---------------------------------------------------------------------------------------------
// Pipeline fakes

export class FakeDetector implements LandmarkDetector {
  faces: readonly DetectedFace[] = [];
  readonly timestamps: number[] = [];
  closeCount = 0;
  /** Number of upcoming detect() calls that throw. */
  throwCount = 0;

  detect(_video: HTMLVideoElement, timestampMs: number): readonly DetectedFace[] {
    this.timestamps.push(timestampMs);
    if (this.throwCount > 0) {
      this.throwCount--;
      throw new Error("fake inference failure");
    }
    return this.faces;
  }

  close(): void {
    this.closeCount++;
  }
}

/** Frame scheduler driven by the test: tick(t) delivers one frame to pending requests. */
export class ManualFrames implements VideoFrameScheduler {
  private pending: { readonly callback: (t: number) => void; cancelled: boolean }[] = [];
  cancelCount = 0;

  request(_video: HTMLVideoElement, callback: (timestampMs: number) => void): () => void {
    const entry = { callback, cancelled: false };
    this.pending.push(entry);
    return () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      this.cancelCount++;
    };
  }

  get pendingCount(): number {
    return this.pending.filter((entry) => !entry.cancelled).length;
  }

  /** Delivers a frame at `timestampMs`. Returns how many callbacks ran. */
  tick(timestampMs: number): number {
    const due = this.pending.filter((entry) => !entry.cancelled);
    this.pending = [];
    for (const entry of due) entry.callback(timestampMs);
    return due.length;
  }
}

// ---------------------------------------------------------------------------------------------
// Session harness

export interface HarnessOptions {
  readonly mirrored?: boolean;
  readonly supported?: boolean;
  readonly loadError?: Error;
  readonly config?: VisionConfigOverrides;
  readonly playerGestures?: VisionSessionOptions["playerGestures"];
}

export interface Harness {
  readonly session: InternalVisionSession;
  readonly events: VisionEvent[];
  readonly frames: ManualFrames;
  readonly devices: FakeMediaDevices;
  readonly detector: FakeDetector;
  readonly video: FakeVideoElement;
  readonly clock: { now: number };
  loadCount(): number;
  /** Events of one type. */
  ofType<T extends VisionEvent["type"]>(type: T): Extract<VisionEvent, { type: T }>[];
  /** Runs frames from `fromMs` (inclusive) to `toMs` (inclusive) at `fps`. Returns the last time. */
  run(
    fromMs: number,
    toMs: number,
    fps: number,
    facesAt: (t: number) => readonly DetectedFace[],
  ): number;
}

/** Camera x (raw frame) of the face that appears on the left / right of a mirrored preview. */
export const MIRRORED_LEFT_CX = 0.7;
export const MIRRORED_RIGHT_CX = 0.3;

/** Two faces for a mirrored preview: P1 (left of the preview) and P2 (right). */
export function twoFaces(
  specs: Partial<PerPlayer<Partial<FaceSpec>>> = {},
): readonly DetectedFace[] {
  return [
    makeFace({ cx: MIRRORED_RIGHT_CX, ...specs[2] }),
    makeFace({ cx: MIRRORED_LEFT_CX, ...specs[1] }),
  ];
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const config = mergeVisionConfig(DEFAULT_VISION_CONFIG, options.config);
  const devices = new FakeMediaDevices();
  const detector = new FakeDetector();
  const frames = new ManualFrames();
  const video = new FakeVideoElement();
  const clock = { now: 0 };
  const events: VisionEvent[] = [];
  let loads = 0;
  const session = createVisionSessionWith(
    {
      camera: createCameraAdapter({
        getMediaDevices: () => asMediaDevices(devices),
        isSecureContext: () => true,
        camera: config.camera,
      }),
      loadDetector: () => {
        loads++;
        return options.loadError
          ? Promise.reject(options.loadError)
          : Promise.resolve<LandmarkDetector>(detector);
      },
      frames,
      now: () => clock.now,
      isSupported: () => options.supported ?? true,
    },
    {
      video: asVideo(video),
      mirrored: options.mirrored ?? true,
      ...(options.playerGestures ? { playerGestures: options.playerGestures } : {}),
    },
    config,
  );
  session.subscribe((event) => events.push(event));
  return {
    session,
    events,
    frames,
    devices,
    detector,
    video,
    clock,
    loadCount: () => loads,
    ofType<T extends VisionEvent["type"]>(type: T) {
      return events.filter(
        (event): event is Extract<VisionEvent, { type: T }> => event.type === type,
      );
    },
    run(fromMs, toMs, fps, facesAt) {
      const step = 1000 / fps;
      let last = fromMs;
      for (let t = fromMs; t <= toMs + 1e-9; t += step) {
        clock.now = t;
        detector.faces = facesAt(t);
        frames.tick(t);
        last = t;
      }
      return last;
    },
  };
}

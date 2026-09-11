# Task: Agent 2 — Vision and Gesture

You are the **Vision and Gesture agent** for Vision Dino, a two-player browser endless runner
inspired by the Chrome Dino game. One webcam sees both players. **Player 1 jumps by deliberately
blinking; Player 2 jumps by deliberately opening their mouth.** You build the camera,
face-landmark and gesture subsystem. It runs **entirely in the browser**, emits semantic events,
and **never touches game state**.

Required reading before you start: `AGENTS.md` (especially the privacy rules),
`docs/architecture.md` §3–§10, §13–§16, and `src/shared/vision.ts` (the contract you implement).

## Goal

A `VisionSession` implementation that opens the camera on request, detects up to two faces
locally with MediaPipe Face Landmarker, assigns them to Player 1 and Player 2, calibrates each
player, and emits exactly one `gesture` event per deliberate blink (Player 1) or mouth opening
(Player 2). It comes with a standalone **Vision Lab** diagnostic page for tuning.

## Branch and worktree

Work in the `agent/vision-gestures` branch, in the worktree `../dino-vision-gestures`
(`docs/workflow.md`). Run `npm ci` first. Never commit to `main`. When your task is done, push
`agent/vision-gestures` and open a draft pull request into `main` (`AGENTS.md`, Git rules).

## Owned files

- `src/vision/**` (including `src/vision/README.md` and the dev page `src/vision/lab/**`)
- `tests/vision/**`
- `public/vision/**` (self-hosted model and WASM assets; decision O-01)
- **Pre-approved:** adding `@mediapipe/tasks-vision` (exact pinned version) to `package.json` and
  `package-lock.json`, in one dedicated commit.

## Do not modify

- `src/shared/**` and `tests/shared/**`: use an Interface Change Request
- `src/game/**`, `tests/game/**` (Agent 1)
- `src/app/**`, `src/ui/**`, `src/main.ts`, `index.html`, `public/**` outside `public/vision/`,
  `tests/app|ui|integration|support/**` (Agent 3)
- Root config files, `AGENTS.md`, `docs/**` (orchestrator)

You must **not** import `src/game`, `src/app` or `src/ui`, call `jumpPlayer`, or know that
gestures mean jumping. Lint enforces this.

## Required interfaces

Implement the `VisionSession` contract from `src/shared/vision.ts` exactly as documented there,
including: `start()` never rejects; `stop()` is idempotent and restartable; `dispose()`; events
are edge-triggered; diagnostics are polled.

Public API from `src/vision/index.ts`:

```ts
import type { VisionSessionFactory } from "../shared";

/** Production factory: real camera, lazily loaded MediaPipe, default config. */
export const createVisionSession: VisionSessionFactory;

/** True when navigator.mediaDevices.getUserMedia exists and the page is a secure context. */
export function isCameraSupported(): boolean;

export interface VisionConfig {
  /* camera constraints, numFaces, thresholds, minActiveMs, cooldownMs, smoothing,
     faceLostAfterMs, reacquireWindowMs, assignmentStableMs, calibration timings, ... */
}
export const DEFAULT_VISION_CONFIG: Readonly<VisionConfig>;
```

Internal seams, which are not public but required for testability:

```ts
interface CameraAdapter {
  open(): Promise<MediaStream>;
  close(): void;
} // built on an injected MediaDevices
interface LandmarkDetector {
  detect(video: HTMLVideoElement, timestampMs: number): readonly DetectedFace[];
  close(): void;
}
type LandmarkDetectorLoader = () => Promise<LandmarkDetector>; // production: dynamic import
interface DetectedFace {
  landmarks: readonly { x: number; y: number; z: number }[];
  /* camera space, optional pose */
}
interface FaceAssigner {
  /* update(faces, t) → per-player faces + transitions; lock(); swap(); reset() */
}
// plus an internal factory such as createVisionSessionWith(deps, options, config)
```

## Implementation steps

1. **Add the dependency.** Install `@mediapipe/tasks-vision` with an exact version (1.0.1 was
   current on 2026-09-11) in its own commit. **Verify the API against the installed type
   definitions**: `docs/architecture.md` §15 documents 0.10.x usage, which may have changed in
   1.x. Record the version and any API differences in your report.
2. **Assets (decision O-01: self-host, and commit the model).** Serve the WASM and
   `face_landmarker.task` from the site origin: `public/vision/`, or Vite `?url` imports for
   the WASM if the package `exports` allow it. **Commit the model binary** in its own commit,
   and record its version, source URL, license (check the model card) and SHA-256 in
   `public/vision/README.md`. Build URLs from `import.meta.env.BASE_URL`. No CDN requests at
   runtime. Record the asset sizes in your report.
3. **Lazy loading.** The production `LandmarkDetectorLoader` uses
   `await import("@mediapipe/tasks-vision")`, so the library is split out of the main bundle
   and never loaded in keyboard-only mode. Check the build output to confirm.
4. **Camera adapter** (`src/vision/camera/`): `getUserMedia({ video: { facingMode: "user", width:
{ ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false })`. Map
   errors to `VisionErrorCode`: `NotAllowedError`/`SecurityError` → `camera-permission-denied`;
   `NotFoundError`, and `OverconstrainedError` after one retry with relaxed constraints →
   `camera-not-found`; `NotReadableError`/`AbortError` → `camera-in-use`; missing API or
   insecure context → `camera-unsupported`. A track `ended` event while running →
   `camera-disconnected`. `close()` stops **all** tracks.
5. **Frame loop:** `requestVideoFrameCallback` with a `requestAnimationFrame` fallback, at most
   one inference in flight, strictly increasing timestamps passed to `detectForVideo`, and
   cancellation on stop. Measure fps and inference ms for the diagnostics.
6. **Geometry** (`src/vision/geometry/`): `toDisplayX` / `toDisplayPoint` for
   `mirrored: true | false`, aspect correction to pixel space, face bounding boxes (§8).
7. **Face assigner** (`src/vision/assignment/`): implement §9 of the architecture (lock by
   display-space left/right, tracking with a swap margin, `faceLostAfterMs`, `reacquireWindowMs`,
   swap, reset, the single-face case, debounced `faces-changed`). Keep it behind the
   `FaceAssigner` interface so the strategy can be replaced.
8. **Metrics** (`src/vision/gestures/metrics.ts`): EAR (both eyes combined with max) and MAR as
   pure functions (§10.1). **Verify the landmark indices** in the Lab by drawing them.
9. **Normalisation and calibration** (`src/vision/calibration/`): neutral and gesture sampling
   per player, run concurrently; threshold derivation; validation; the failure reasons in
   `CalibrationFailureReason`; `useDefaultCalibration()`; progress events. Data lives in
   memory only; lint forbids storage APIs.
10. **Smoothing:** a time-constant EMA (τ configurable, ≈ 40 ms).
11. **Hysteresis detector** (`src/vision/gestures/`): the time-based state machine in §10.4
    (`disarmed`/`idle`/`pending`/`active`), `minActiveMs`, `cooldownMs`, one event on entering
    `active`, and cancellation on a `null` score.
12. **Quality gate:** head pitch and yaw from the facial transformation matrices (if available),
    plus a minimum face size. A failed gate gives a score of `null`.
13. **Session** (`src/vision/session.ts`): compose everything; status transitions
    `idle → requesting-camera → loading-model → running` (or `error`); events; diagnostics;
    `stop()` cancels the loop, stops the tracks, clears `video.srcObject`, and emits nothing
    afterwards; `dispose()` also closes the detector. Consider loading the model in parallel with
    the camera request, but the camera must still be requested from the caller's click.
14. **Vision Lab** (`src/vision/lab/index.html` + `main.ts`, dev only, at
    `http://localhost:5173/src/vision/lab/`): a "processing stays on this device" notice;
    Start and Stop buttons (the camera starts only on click); a mirrored toggle; a preview with an
    unmirrored overlay (face boxes, P1/P2 labels, optional landmark points); per-player live
    metric, score, thresholds and state (a sparkline is helpful); a scrolling event log;
    Calibrate, Use defaults, Swap and Reset buttons; fps and inference ms. It is not in the
    production build.
15. **Document** the public API in TSDoc (`src/vision/index.ts`) and `src/vision/README.md`
    (config, events, tuning guide, privacy guarantees).

## Acceptance criteria

- [ ] `npm run check` passes.
- [ ] The Vision Lab runs locally: camera on and off by button, zero, one or two faces shown
      correctly, P1 always the left face of the preview at lock (mirrored and unmirrored).
- [ ] Eyes open → closed emits exactly **one** `gesture` (`blink`, player 1). Keeping them
      closed emits nothing; they must reopen before another event. The same holds for the
      mouth (`mouth-open`, player 2).
- [ ] No event bursts from a signal oscillating inside the hysteresis band; cooldown respected.
- [ ] A reacquired face never fires a gesture until the reset condition is observed.
- [ ] Small head movements never swap identities. Swap and reset work.
- [ ] `face-lost` and `face-found` are emitted once per occurrence (debounced).
- [ ] `start()` returns `{ ok: false, error.code }` for permission denied, not found, in use,
      unsupported and model-load failure, and emits matching `error` and `status-changed` events.
- [ ] After `stop()`, every track is stopped, `video.srcObject` is `null`, the loop is cancelled
      and no further events arrive. Start after stop works.
- [ ] No frames, landmarks or calibration data are stored or transmitted (lint clean; code
      review). Model and WASM come from the site origin.
- [ ] MediaPipe is split into a lazy chunk (visible in the `npm run build` output).
- [ ] Public API as specified, documented in TSDoc and `src/vision/README.md`.

## Required tests (`tests/vision/**`)

Tests use synthetic data only: no camera, no model, no network, and never import the MediaPipe
package.

- Geometry: the mirrored and unmirrored display mapping; aspect-corrected distances on 16:9
  frames.
- Metrics: EAR and MAR on hand-built landmark fixtures (open, closed, wink with max combination,
  non-square frames).
- Detector state machine: a single event per activation; held gesture; required reset;
  hysteresis band with noisy input; `minActiveMs` rejects short spikes; cooldown; `disarmed`
  after reacquire; a `null` score cancels `pending`; the same number of events at 15, 30 and
  60 fps.
- Smoothing: time-constant behaviour independent of frame rate.
- Face assigner: lock ordering for both mirror settings; jitter without swaps; continuous
  crossing keeps identity; one face lost then reacquired; both lost with window expiry leading
  to side-based re-lock; swap; reset; single face; extra faces.
- Calibration: threshold derivation, too little separation → failure, timeout, cancel, default
  mode, and calibration following a swap.
- Session with a fake `MediaDevices` and a fake `LandmarkDetector`: status sequence, every
  error mapping, `stop()` track cleanup and srcObject reset, no events after stop, restart,
  dispose, event ordering, diagnostics content.

## Validation commands

```bash
npm ci
npx vitest run tests/vision
npm run typecheck
npm run lint
npm run format:check
npm run build          # check that MediaPipe is emitted as a separate chunk
npm run check          # all gates; required before reporting done
npm run dev            # manual: http://localhost:5173/src/vision/lab/
git diff --name-only main...HEAD | grep -Ev '^(src/vision/|tests/vision/|public/vision/|package(-lock)?\.json$)'   # must print nothing
```

## Deliverables

1. The `src/vision/**` implementation with the public API above.
2. `tests/vision/**` covering the required tests, with synthetic fixtures.
3. The Vision Lab dev page.
4. Model and WASM hosting (plus its license and size notes).
5. `src/vision/README.md` with a tuning guide.
6. A report in the `AGENTS.md` format, including: the MediaPipe version and API differences;
   verified landmark indices; measured fps and inference ms (browser, version, GPU or CPU,
   camera); tuned default thresholds; false-positive observations (natural blinks, talking,
   looking down); limitations; ICRs.

## Dependencies on other agents

- Needs only the Phase 1 contracts in `src/shared`.
- Agent 3 will consume `createVisionSession`, `isCameraSupported` and the events and
  diagnostics. Keep them stable.
- Independent of Agent 1. Never import game code.

## Known risks

- Noisy eye landmarks on small or distant faces; the metrics need a minimum face size.
- Involuntary blinks, talking or laughing, and looking down causing false positives
  (§10.7–§10.8).
- MediaPipe 1.x API or asset layout differing from the documentation; GPU delegate failures.
- Detector face order changing between frames (never rely on it).
- `detectForVideo` rejecting non-increasing timestamps.
- Main-thread inference time hurting game frame rate (report measurements; the worker option is
  O-08).

## Escalate to the orchestrator when

- The `VisionSession` contract or the events cannot express what the UI will need (for example
  richer calibration guidance).
- You need a dependency other than `@mediapipe/tasks-vision`, or any third-party runtime
  request.
- Model or WASM hosting cannot follow O-01.
- You would need to persist anything, or a lint privacy rule blocks you.
- The acceptance criteria cannot be met on target hardware (report the measurements).

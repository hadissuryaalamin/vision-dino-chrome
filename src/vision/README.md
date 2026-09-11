# Vision module (`src/vision`)

Local camera, face landmarks and gesture detection for Vision Dino. It implements the
`VisionSession` contract from [`src/shared/vision.ts`](../shared/vision.ts), emits semantic
`VisionEvent`s, and never touches game state. Player 1 jumps by blinking, Player 2 by opening
their mouth (`DEFAULT_PLAYER_GESTURES`); this module only reports gestures, it does not know what
they mean.

## Privacy guarantees

- **All processing is local.** Frames go from the `<video>` element straight to in-page
  WebAssembly inference (MediaPipe Face Landmarker). Nothing is uploaded, recorded or saved.
- **No persistence.** Landmarks, metrics and calibration data live in memory for the session
  only. `stop()` clears calibration; `dispose()` also releases the model. Lint forbids storage
  and network APIs in `src/vision`.
- **Camera only on request.** Creating a session does nothing; `start()` must be called from an
  explicit user action. Audio is never requested (`audio: false`).
- **Tracks are always stopped** by `stop()`, `dispose()`, runtime errors, and when a start is
  cancelled (including a stream that arrives after `stop()`).
- **Self-hosted assets.** The model (`public/vision/face_landmarker.task`) and the WASM runtime
  are served from the site origin (decision O-01). See
  [`public/vision/README.md`](../../public/vision/README.md) for provenance and licence.
- **MediaPipe's own usage metrics.** `@mediapipe/tasks-vision` 1.0.1 has a built-in logger that
  POSTs performance and usage metrics (no images or landmarks) to `odml.pa.googleapis.com`. There
  is no option to disable it, so pages must block it with a CSP (`connect-src 'self'`). The Vision
  Lab does; the production CSP (Agent 3, architecture §14) must. This is escalated to the
  orchestrator.

## Public API (`index.ts`)

```ts
import { createVisionSession, isCameraSupported, DEFAULT_VISION_CONFIG } from "../vision";

const vision = createVisionSession({ video, mirrored: true }); // no side effects
vision.subscribe((event) => {
  /* VisionEvent */
});
if (isCameraSupported()) {
  button.onclick = async () => {
    const result = await vision.start(); // never rejects
    if (!result.ok) showError(result.error.code);
  };
}
vision.startCalibration(); // or vision.useDefaultCalibration()
vision.getDiagnostics(); // poll, e.g. once per animation frame
await vision.stop(); // or dispose()
```

| Export                   | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `createVisionSession`    | `VisionSessionFactory`: real camera, lazily loaded MediaPipe, default config. |
| `isCameraSupported()`    | `getUserMedia` exists and the page is a secure context. Touches nothing.      |
| `DEFAULT_VISION_CONFIG`  | Frozen default `VisionConfig`.                                                |
| `VisionConfig` and parts | Types: `CameraConfig`, `DetectorConfig`, `GestureTuning`, `MetricTuning`, ... |

The internal factory `createVisionSessionWith(deps, options, config)` (`session.ts`) takes
injected dependencies (`CameraAdapter`, `LandmarkDetectorLoader`, `VideoFrameScheduler`, clock)
and a configuration. Tests and the Vision Lab use it; the app should use `createVisionSession`.

## Lifecycle

```text
idle ─start()─► requesting-camera ─► loading-model ─► running
  ▲                    │                  │             │ track ended / repeated inference errors
  │                    └──────────────────┴─────────────┴──► error
  └──────────────────────── stop() (from any status) ◄──────────┘
```

- The camera is requested synchronously inside `start()`, and the model loads **in parallel**.
  The status still passes through `loading-model` after the camera is granted.
- `start()` while running resolves `{ ok: true }`; while starting it returns the pending
  promise. After an error, `start()` can be called again.
- `start()` failures: `camera-unsupported`, `camera-permission-denied`, `camera-not-found`,
  `camera-in-use`, `model-load-failed`, `unknown`. Each resolves `{ ok: false, error }` **and**
  emits `error` followed by `status-changed` (to `error`).
- Runtime failures: `camera-disconnected` (a track's `ended` event), `inference-failed` (3
  consecutive detector exceptions). Same two events.
- `stop()` is idempotent: it cancels the frame loop, stops every track, sets
  `video.srcObject = null`, ends a running calibration (`calibration-failed`, `cancelled`),
  clears calibration data, and emits `status-changed` (to `idle`) as its last event. A `start()`
  still pending resolves `{ ok: false, error: { code: "unknown" } }` without events.
- `dispose()` stops, then closes the detector. The session cannot be started again.

## Events

All events are edge-triggered. Frame-driven events carry the video frame timestamp
(`performance.now()` clock); API-driven events carry the time of the call.

| Event                  | When                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `status-changed`       | Every status transition.                                                                                |
| `error`                | A start or runtime failure (always followed by `status-changed` to `error`).                            |
| `faces-changed`        | The detected face count changed and stayed changed for 250 ms.                                          |
| `players-assigned`     | `calibration` (first lock), `reset` (lock after `resetAssignment()`), `swapped`, `reacquired`.          |
| `face-lost`            | A tracked player's face has been missing for 400 ms. Once per occurrence.                               |
| `face-found`           | A lost player's face has been visible again for 200 ms. Once per occurrence.                            |
| `gesture`              | Once per activation (`blink` or `mouth-open`), on the idle → active transition.                         |
| `calibration-progress` | Step start (0), then at most every 10 % of a step.                                                      |
| `calibration-complete` | Per player: `mode: "calibrated"` (measured) or `"default"` (`useDefaultCalibration()`).                 |
| `calibration-failed`   | Per player, or `playerId: null` for `not-running`, `not-enough-faces` and cancellation while assigning. |

Order within one frame: `faces-changed`, `players-assigned`, `face-lost`/`face-found`,
calibration events, `gesture`. Listeners run synchronously in subscription order; a throwing
listener is reported asynchronously and does not affect the others.

**Gestures fire only for a calibrated player.** Until `startCalibration()` completes or
`useDefaultCalibration()` is called, scores are computed for display (with the default levels)
but the detector stays `disarmed`.

## Player assignment

Implemented by the replaceable `FaceAssigner` (`assignment/assigner.ts`), in display space so
mirroring is handled once (`geometry/`):

1. Before the lock, faces are labelled by side every frame (two largest faces: left of the
   preview → Player 1; a single face: left half → Player 1).
2. When two faces have been visible for `assignmentStableMs` (750 ms), the mapping is locked
   (`players-assigned`, `calibration`).
3. After the lock, identity follows the person (decision O-06): detections are matched to each
   track's predicted position by distance in face widths; the detector's order is ignored. If the
   two possible matchings are within `swapMargin` of each other (overlapping faces), positions are
   held instead of updated, so jitter and crossings do not swap identities.
4. Lost and reacquired faces follow docs/architecture.md §9: a new face goes to the lost player
   while the other is tracked; if both were lost, faces are matched to their last positions within
   `reacquireWindowMs` (3 s), otherwise re-locked by side (`reacquired`).
5. `swapPlayers()` exchanges the players; **calibration stays with the player id** (P1 keeps the
   blink calibration), so swapping corrects a mix-up. `resetAssignment()` returns to side-based
   labels until the next lock (`reset`). Both disarm the detectors; a running calibration restarts
   its measurement (swap) or its assignment step (reset).

## Gesture pipeline

Per player: metric → quality gate → smoothing → normalisation → hysteresis state machine.

- **Metrics** (`gestures/metrics.ts`, pixel space): blink = eye aspect ratio of the more open
  eye (max, so winks do not count); mouth = mean inner-lip gap over mouth width. Optional
  `metricSource: "blendshapes"` uses `min(eyeBlinkLeft, eyeBlinkRight)` and `jawOpen`.
- **Quality gate**: face narrower than `minFaceWidthPx` (80 px), or head pitch/yaw beyond
  25°/30° (from the facial transformation matrix) → score `null`.
- **Smoothing**: time-constant EMA, τ = 40 ms, identical at any frame rate.
- **Normalisation**: 0 = neutral level, 1 = gesture level (calibrated or default), clamped.
- **State machine** (`gestures/hysteresis.ts`): `disarmed → idle → pending → active`; enters
  `active` (one event) after the score stays ≥ enter for `minActiveMs` and the cooldown is over;
  returns to `idle` only at ≤ exit. `null` cancels `pending` and never advances. Disarmed after
  start, calibration, swap, reset, face lost and face found.

## Calibration

`startCalibration(players?)`, both players concurrently (`calibration/calibration.ts`):

1. `assign-players`: wait for the lock (one player: tracked for 750 ms). 10 s → `not-enough-faces`.
2. `neutral` (2 s): median and robust noise (IQR) of the metric. Noise above `maxNeutralNoise`
   → `unstable-measurements`.
3. `gesture` (10 s): three deliberate gestures, each at least max(`minSeparation`, 4 × noise)
   away from neutral and returning halfway. The gesture level is the median of the peaks.
   Nothing seen → `gesture-not-detected`; too few → `timeout`.

A lost face fails that player with `face-lost`. `useDefaultCalibration(players?)` applies
population defaults (EAR 0.28 → 0.12, MAR 0.05 → 0.45) and emits exactly one
`calibration-complete` with `mode: "default"` per requested player (duplicates ignored), in any
status.

**One face visible.** A single face is never bound to the player you name. Before the lock it
belongs to the player on its side of the preview (display x < 0.5 → Player 1, architecture §9
item 5). `startCalibration([p])` therefore waits until player `p` has been tracked for 750 ms. If
the only face is on the other side, it fails with `not-enough-faces` (`playerId: null`) after
10 s. Choose the camera player by the side of the preview (or check
`getDiagnostics().players[p].tracking === "tracked"`) before calling it.

## Configuration

`VisionConfig` (`config.ts`) groups: `camera`, `detector`, `metricSource`, `smoothingTauMs`,
`gestures` (enter/exit/minActiveMs/cooldownMs per gesture), `metrics` (default levels and
calibration limits per source and gesture), `quality`, `assignment`, `calibration`,
`maxConsecutiveInferenceErrors`. Defaults follow docs/architecture.md §10.10:

| Parameter                             | Default                                    |
| ------------------------------------- | ------------------------------------------ |
| Camera                                | `user`, ideal 1280×720 at 30 fps, no audio |
| `numFaces` / confidences / delegate   | 2 / 0.5 / GPU with CPU fallback            |
| Blink enter / exit / minActive / cool | 0.60 / 0.35 / 80 ms / 350 ms               |
| Mouth enter / exit / minActive / cool | 0.55 / 0.30 / 80 ms / 350 ms               |
| Smoothing τ                           | 40 ms                                      |
| Min face width / max pitch / max yaw  | 80 px / 25° / 30°                          |
| Lost / found / reacquire / stable     | 400 / 200 / 3000 / 750 ms                  |
| Calibration neutral / timeout / reps  | 2 s / 10 s / 3                             |

**None of these values has been tuned on real faces yet.**

## Tuning guide (Vision Lab)

Run `npm run dev` and open <http://localhost:5173/src/vision/lab/>. The page shows the preview
with an unmirrored overlay (face boxes, P1/P2 labels, optional landmarks and the metric points
with their indices), per-player metric, score, thresholds, state, calibration levels and a 5 s
score sparkline, fps and inference time, and an event log. The tuning form recreates the session
with new values.

1. **Verify the landmark indices**: enable "Metric points". Points 33/133 and 362/263 must sit
   on the eye corners, 160/158/153/144 and 385/387/373/380 on the eyelids, 78/308 on the inner
   mouth corners and 82/87, 13/14, 312/317 on the inner lips.
2. **Check the geometry**: with the preview mirrored and unmirrored, the P1 label must be on the
   face on the left of the preview at lock.
3. **Calibrate** both players and read the levels. A good blink separation is > 0.1 EAR.
4. **Thresholds**: watch the sparkline. Natural blinks should stay below the enter line (green);
   deliberate blinks must cross it for longer than `minActiveMs`. Raise `enterThreshold` or
   `minActiveMs` for false positives; lower them if deliberate gestures are missed.
5. **Talking and laughing**: talk for 30 s and count mouth events; raise the mouth enter
   threshold or recalibrate with a wider opening.
6. **Looking down**: look at the keyboard; the quality gate should show `head-pose` and the score
   should go to `–`. Adjust `maxPitchDeg` if needed.
7. **Distance**: step back until the gate shows `face-too-small`; tune `minFaceWidthPx`.
8. **Performance**: note fps and inference ms (GPU and CPU delegate) with the game running.
9. Record the tuned values, browser, camera and measurements in the Phase 4 report.

## Assets and MediaPipe

- `@mediapipe/tasks-vision` **1.0.1** (exact pin), loaded only through dynamic imports
  (`landmarks/loader.ts` → `landmarks/mediapipe-detector.ts` → the package), so it is a separate
  lazy chunk and keyboard-only play never downloads it.
- The API used matches docs/architecture.md §15 (verified against the installed `vision.d.ts`):
  an explicit `WasmFileset { wasmLoaderPath, wasmBinaryPath }`,
  `FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate },
runningMode: "VIDEO", numFaces, ... })`, `detectForVideo(video, timestampMs)` (synchronous,
  strictly increasing timestamps) and `close()`. Differences worth knowing: the package ships
  SIMD, no-SIMD and ES-module WASM builds and exports each file (we pick SIMD or no-SIMD with
  `FilesetResolver.isSimdSupported()`); the image type is `TexImageSource` (`ImageSource` is a
  deprecated alias); `TaskRunner.enableLogging()` is declared but absent from the runtime bundle;
  and the built-in usage logger described above.
- The WASM files are Vite `?url` imports of the package's exported files, emitted with hashed
  names; the model URL is built from `import.meta.env.BASE_URL`.

## Testing

`tests/vision/**` runs in Node with synthetic landmark fixtures (`fixtures.ts`: faces with exact
EAR/MAR, fake video, tracks, `MediaDevices`, detector and frame scheduler). No test needs a
camera, the model or the network, and none imports `@mediapipe/tasks-vision`.

## Not yet verified (needs a person with a camera)

The Vision Lab run itself, the landmark indices, the head-pose sign/layout handling on real
matrices, all threshold values, false-positive rates (natural blinks, talking, looking down),
fps and inference time, GPU delegate availability, `requestVideoFrameCallback` capture times, and
the WASM `?url` loading in the browser.

## Known limitations

- A bystander can replace a player's face with `numFaces: 2` (R-09).
- Players who cross while fully occluding each other for longer than 400 ms go through the
  lost/found path; identities may need **Swap players**.
- Before the lock (one face only), identity is by side of the preview.
- Inference runs on the main thread (O-08); a Web Worker can implement `LandmarkDetector` later
  (the session already accepts asynchronous results).

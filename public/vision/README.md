# Self-hosted vision assets

Everything the camera mode needs is served from the site's own origin (decision O-01). No CDN
or other third-party host is contacted to load the model or the WebAssembly runtime.

## `face_landmarker.task`

| Field       | Value                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What        | MediaPipe Face Landmarker model bundle (float16)                                                                                                                       |
| Version     | `float16/1` (the same object as `float16/latest` on 2026-09-11: identical ETag / MD5 `b0e7274907a1644404fef66b28dd6d85`; `Last-Modified: Wed, 03 May 2023 18:02:21 GMT`) |
| Source      | <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>                                                        |
| Downloaded  | 2026-09-11                                                                                                                                                             |
| Size        | 3,758,596 bytes (3.6 MiB)                                                                                                                                              |
| SHA-256     | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`                                                                                                     |
| License     | Apache License, Version 2.0 (see [`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt))                                                                                   |
| Copyright   | Google LLC (MediaPipe authors)                                                                                                                                         |
| Modified?   | No. The file is committed byte-for-byte as downloaded.                                                                                                                 |

The bundle is a ZIP archive containing four models. The licence of each is stated on its
official model card ("LICENSED UNDER Apache License, Version 2.0"):

| File in the bundle                          | Model                        | Model card                                                                                                     |
| ------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `face_detector.tflite`                      | BlazeFace (short range)      | <https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf>   |
| `face_landmarks_detector.tflite`            | Face Mesh V2 (478 landmarks) | <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf>              |
| `face_blendshapes.tflite`                   | Blendshape V2                | <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf>                           |
| `geometry_pipeline_metadata_landmarks.binarypb` | Face geometry metadata   | (part of the bundle; MediaPipe is Apache-2.0)                                                                  |

The model cards list the models' intended uses and limitations. Of note for this project:
the face mesh model "does not provide facial recognition or identification and does not store
any unique face representation", and quality degrades for faces turned more than about 80°,
partially visible faces, and faces too far from the camera.

### Verify

```bash
sha256sum public/vision/face_landmarker.task
# 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
```

Automated tests deliberately never read or load the model (AGENTS.md), so check the hash by
hand after any change to this file.

## WebAssembly runtime

The WASM runtime is **not** copied into this folder. `src/vision/landmarks/mediapipe-detector.ts`
imports it from the installed `@mediapipe/tasks-vision` package with Vite `?url` imports (the
package's `exports` map allows this), so the build emits hashed copies into `dist/assets/` and
the runtime always matches the pinned library version. Files used (version 1.0.1):

| File                               | Size (bytes) | SHA-256                                                            |
| ---------------------------------- | -----------: | ------------------------------------------------------------------ |
| `vision_wasm_internal.js`          |      323,377 | `e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73` |
| `vision_wasm_internal.wasm`        |   11,756,954 | `8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886` |
| `vision_wasm_nosimd_internal.js`   |      323,180 | `e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658` |
| `vision_wasm_nosimd_internal.wasm` |   10,960,242 | `a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192` |

Only one pair is downloaded at runtime: the SIMD build, or the no-SIMD build when the browser
lacks WebAssembly SIMD. `@mediapipe/tasks-vision` is Apache-2.0.

## MediaPipe usage metrics (important)

`@mediapipe/tasks-vision` 1.0.1 contains a built-in usage logger. For every task it creates,
it queues performance and usage metrics (task type, running mode, operating system derived from
the user agent, library version, initialisation and inference latency; **no images, landmarks
or other camera data**) and POSTs them to `https://odml.pa.googleapis.com/v1/log` every 60 s and
when the task is closed. The package README says: "MediaPipe Tasks APIs send metrics about the
performance and utilization of the APIs in your app to Google." There is no API option to turn
this off.

This project's rules allow no third-party requests, so the request must be blocked with a
Content Security Policy (`connect-src 'self'`): the Vision Lab page sets one, and the
production CSP planned in `docs/architecture.md` §14 covers the app. When the request is
blocked, MediaPipe stops its logger after the first failed attempt; detection is unaffected.
This has been escalated to the orchestrator for a decision.

## Updating

1. Download the new `face_landmarker.task` from the official URL above (or a newer versioned
   path), and record the new URL, date, size and SHA-256 here.
2. Re-check the model cards' licence.
3. When upgrading `@mediapipe/tasks-vision`, update the WASM table above and re-check the usage
   logger and the WASM file names (`src/vision/landmarks/mediapipe-detector.ts`).

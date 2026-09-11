# Task: Agent 3 — Integration, UI and QA

You are the **Integration, UI and QA agent** for Vision Dino, a two-player browser endless runner
inspired by the Chrome Dino game. One webcam sees both players; **Player 1 jumps by blinking,
Player 2 by opening their mouth**, and keyboard controls always work too. Agent 1 builds the
game (`src/game`) and Agent 2 builds camera and gesture detection (`src/vision`). **You connect
them into the application users see, own the whole user experience, and lead QA and
stabilisation.**

Required reading before you start: `AGENTS.md`, `docs/architecture.md` (all, especially §3, §6,
§8, §12–§14 and §17), `docs/workflow.md` (Phases 3–4), `docs/decisions.md` and `src/shared/`.

## Goal

A complete, accessible, responsive static web app. It routes keyboard and vision actions into
the game through the shared action interface, guides players through camera permission,
positioning and calibration, handles every failure with a keyboard fallback, provides a
switchable vision debug overlay, and is verified by integration tests, Playwright end-to-end
tests and the Phase 4 QA checklist. It deploys to GitHub Pages on every push to `main`.

## Branch and worktree

Work in the `agent/integration-qa` branch, in the worktree `../dino-integration-qa`
(`docs/workflow.md`). Run `npm ci` first. Never commit to `main`. When your task is done, push
`agent/integration-qa` and open a draft pull request into `main` (`AGENTS.md`, Git rules). Full
integration starts after both Phase 2 branches are merged into `main`. Before that, you may
build against the contracts and fakes only (optional early start).

## Owned files

- `src/main.ts`, `src/app/**`, `src/ui/**` (including CSS), `index.html`
- `public/**` except `public/vision/**`
- `tests/app/**`, `tests/ui/**`, `tests/integration/**`, `tests/support/**`
- `e2e/**` and `playwright.config.ts` (Playwright end-to-end tests; decision O-05)
- `.github/workflows/**` (GitHub Pages deployment; decision O-02)
- `vite.config.ts` (from Phase 3: `base`, build inputs, the CSP plugin)
- **Pre-approved:** adding `@playwright/test` (dev dependency) and a `test:e2e` script to
  `package.json` and `package-lock.json`, in one dedicated commit.

## Do not modify

- `src/shared/**` and `tests/shared/**`: use an Interface Change Request
- `src/game/**`, `tests/game/**` (Agent 1); `src/vision/**`, `tests/vision/**`, `public/vision/**`
  (Agent 2). If integration genuinely needs a change there, escalate. Do not patch it yourself.
- `package.json` and `package-lock.json` beyond the pre-approved Playwright commit;
  `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `AGENTS.md`, `CLAUDE.md`, `docs/**`

## Required interfaces

You consume:

- From `src/shared`: `PlayerAction`, `PlayerInputSource`, `GameController`, `GameSnapshot`,
  `GameEvent`, `VisionSession`, `VisionSessionFactory`, `VisionEvent`, `VisionDiagnostics`,
  `VisionErrorCode`, `GestureKind`, `DEFAULT_PLAYER_GESTURES`, `PerPlayer`, `PlayerId`,
  `Unsubscribe`.
- From `src/game/index.ts` (Agent 1): `createGame`, `GameHandle`, `createKeyboardInputSource`,
  `DEFAULT_KEY_BINDINGS`.
- From `src/vision/index.ts` (Agent 2): `createVisionSession`, `isCameraSupported`.

Import game and vision **only** through their `index.ts` (lint enforces this). `src/ui` imports
only `src/shared` and other UI modules; `src/app` passes it plain data and callbacks.

You provide (`src/app`):

```ts
/** Adapts semantic vision events into game-facing actions. start() only begins forwarding. */
export function createVisionInputSource(
  session: VisionSession,
  playerGestures?: PerPlayer<GestureKind>, // default DEFAULT_PLAYER_GESTURES
): PlayerInputSource;
// Each { type: "gesture", playerId, gesture } whose gesture equals playerGestures[playerId]
// becomes { type: "jump", playerId, source: "vision", timestamp: event.timestamp }.
// Other events are not actions.

/** Subscribes to every source and forwards jump actions to game.jumpPlayer. */
export function connectInputs(
  sources: readonly PlayerInputSource[],
  game: Pick<GameController, "jumpPlayer">,
): Unsubscribe;

export interface AppDependencies {
  createGame: (options: { canvas: HTMLCanvasElement }) => GameHandle;
  createKeyboardInputSource: (options: {
    target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  }) => PlayerInputSource;
  createVisionSession: VisionSessionFactory;
  isCameraSupported: () => boolean;
}
export function createApp(root: HTMLElement, deps: AppDependencies): { destroy(): Promise<void> };
```

`src/main.ts` calls `createApp(document.querySelector("#app")!, { ...real factories })`.
Tests pass fakes.

## Implementation steps

1. **Test support first** (`tests/support/`): `FakeGameController` (records calls, scriptable
   snapshot and events), `FakeInputSource` (`emit(action)`), `FakeVisionSession` (scriptable
   `start()` results, `emit(event)`, settable diagnostics, records `stop` and `dispose` calls).
2. **Input routing:** `connectInputs` and `createVisionInputSource`, with unit tests. A held
   gesture yields one vision event, which yields one action and one `jumpPlayer` call.
3. **App state machine** (`src/app/`): screens `welcome`, `camera-starting`, `camera-error`,
   `positioning`, `calibrating`, `ready`, `playing`, `paused`, `game-over`, plus the keyboard-only
   path (`docs/architecture.md` §12). Make it a pure reducer or state machine tested without a
   DOM.
4. **Welcome and privacy:** explain the game and the controls. Before any permission request,
   state that "Camera processing happens only in this browser; video is never uploaded or
   saved." Offer **Play with camera** and **Keyboard only**. Hide or disable the camera option
   with an explanation when `isCameraSupported()` is false.
5. **Camera start:** call `vision.start()` **only** from the Play-with-camera click handler.
   Show loading states for `requesting-camera` and `loading-model`. Map every `VisionErrorCode`
   to clear copy with next steps (retry, how to re-enable permission, or keyboard only).
6. **Positioning:** the live preview (`<video playsinline muted autoplay>`, mirrored by CSS when
   `mirrored: true`, `object-fit: contain`) with an **unmirrored** overlay canvas drawing the face
   rectangles and "P1"/"P2" labels from `getDiagnostics()`. Instructions: "Player 1 on the left,
   Player 2 on the right". Continue once two faces are tracked, or offer to continue with one
   player on the keyboard.
7. **Calibration UI:** per-player step instructions (neutral: look at the screen, eyes open,
   mouth closed; gesture: P1 blink firmly three times, P2 open mouth wide three times), progress
   from `calibration-progress`, success and failure messages per `CalibrationFailureReason`, and
   Retry, Use defaults, Swap players, Reset assignment and Keyboard only buttons.
8. **Game screen:** mount the game canvas, a HUD (scores, status, per-player camera status such
   as "face not visible"), a brief "gesture detected" pulse per player (no strobe; honour
   `prefers-reduced-motion`), and the keyboard legend built from `DEFAULT_KEY_BINDINGS`. App keys:
   Enter start or restart, P or Escape pause and resume, `` ` `` toggles the debug overlay.
   Enter on a focused button must not also trigger the global handler.
9. **Lifecycle:** keyboard input is always active. `visibilitychange` to hidden pauses the game.
   `vision.stop()` runs on keyboard-only, "camera off", `pagehide` and `destroy()`.
   `destroy()` stops everything and unsubscribes all listeners. A face lost during play shows a
   warning and does not auto-pause (decision O-04).
10. **Debug overlay:** off by default; toggled by `` ` `` or `?debug=1`. Show every
    `VisionDiagnostics` field per player (metric, score, thresholds, state, cooldown,
    calibration), plus fps, inference ms and a recent-event log. It polls, and must not
    allocate heavily per frame.
11. **Simulated vision (dev only):** `?vision=simulated` behind `import.meta.env.DEV` and a
    dynamic import. It implements `VisionSession` without a camera and drives gesture events
    from keys (e.g. `1` → P1 blink, `2` → P2 mouth-open), so the UI flows can be exercised by
    hand. It must be absent from the production bundle.
12. **Layout and accessibility:** responsive (game above, camera panel beside or below; stacks
    at narrow widths with no horizontal scroll); semantic buttons; logical focus order; focus
    moves to each new screen's heading; an `aria-live="polite"` status region (assertive for
    errors); a canvas `role="img"` with a text alternative for scores; WCAG AA contrast; no
    information by colour alone; everything operable by keyboard.
13. **Production CSP:** an inline Vite plugin with `apply: "build"` that injects the `<meta>` CSP
    from architecture §14. Verify it with the real, self-hosted MediaPipe assets and adjust only
    what is required.
14. **GitHub Pages deployment (decision O-02: deploy on every push to `main`).** Keep
    `base: "./"` and verify the build under the project sub-path (`/vision-dino-chrome/`). Add
    `.github/workflows/deploy-pages.yml`, triggered by `push` to `main` and `workflow_dispatch`:
    Node 24, `npm ci`, `npm run check`, `actions/upload-pages-artifact` with `dist/`, then
    `actions/deploy-pages`; permissions `contents: read`, `pages: write`, `id-token: write`; a
    `concurrency` group so deployments do not overlap. Pin the actions to major versions. **Do
    not push to `main` or trigger the workflow yourself**: the first deployment happens when the
    user merges into `main`. Tell the user in your report to enable Settings → Pages → Source:
    GitHub Actions.
15. **End-to-end tests (decision O-05):** in one dedicated commit, add `@playwright/test` and a
    `test:e2e` script (`playwright test`). Write `playwright.config.ts` to run Chromium only
    against `npm run preview`, launching with `--use-fake-ui-for-media-stream` and
    `--use-fake-device-for-media-stream`. Cover keyboard-only play (camera never requested),
    permission granted (reaches positioning; the fake camera has no faces) and permission denied
    (error screen with keyboard fallback). `test:e2e` is separate from `npm run check`, so
    `check` stays browser-free.
16. **Phase 4 QA:** run the checklist in `docs/workflow.md` and report results, measurements and
    tested browser versions.

## Acceptance criteria

- [ ] `npm run check` passes, and `npm run test:e2e` passes.
- [ ] Keyboard-only mode is fully playable, and the camera is never requested (verified by test
      and manually).
- [ ] Camera permission is requested only after the explicit click, after the local-processing
      notice.
- [ ] Blink (P1) and mouth opening (P2) each make only their own dino jump, once per gesture.
- [ ] Keyboard and vision inputs work at the same time through the same `connectInputs` path.
- [ ] Every `VisionErrorCode` and calibration failure has a clear message and a path to
      keyboard play.
- [ ] The face-to-player assignment is always visible in camera mode; gesture detection is
      visibly indicated.
- [ ] Zero, one and two faces, and lost or reacquired faces, are handled with clear messages.
- [ ] Camera tracks stop on keyboard-only, camera off, `pagehide` and `destroy()` (tested with
      the fake; browser indicator checked manually).
- [ ] The debug overlay is off by default and can be toggled; the production bundle contains no
      simulated-vision code.
- [ ] Responsive at desktop and narrow widths; keyboard-accessible; screen-reader status
      announcements.
- [ ] `npm run build` output works under `npm run preview`, including from a sub-path; CSP
      active in the build and not in dev.
- [ ] The GitHub Pages workflow deploys on push to `main` after `npm run check`; it was not
      triggered by you.
- [ ] The Phase 4 checklist is completed and reported, with limitations listed and no unverified
      browser claims.

## Required tests

- `tests/app/`: `connectInputs`, `createVisionInputSource` (mapping, filtering of non-gesture
  events, the wrong gesture for a player, unsubscribe, start and stop idempotence), and the app
  state machine transitions.
- `tests/ui/` (`// @vitest-environment jsdom`): screen rendering, focus management, live-region
  announcements, error copy per code, keyboard legend, debug overlay toggle.
- `tests/integration/` (jsdom, all fakes): the full keyboard-only flow; the camera flow (click →
  start → positioning → calibration → play); permission denied → keyboard fallback; model
  failure; calibration failure → defaults; a face lost during play; a single gesture event →
  exactly one `jumpPlayer`; `stop()` called on keyboard switch, `pagehide` and destroy; Enter on
  a focused button not double-starting.
- `e2e/` (Playwright, Chromium with the fake media device): keyboard-only play, permission
  granted, permission denied.

## Validation commands

```bash
npm ci
npx vitest run tests/app tests/ui tests/integration
npm run typecheck
npm run lint
npm run format:check
npm run build
npx playwright install chromium   # once per machine, after adding Playwright
npm run test:e2e
npm run preview        # manual smoke test of the production build at http://localhost:4173/
npm run check          # all gates; required before reporting done
npm run dev            # manual: http://localhost:5173/ and http://localhost:5173/?vision=simulated&debug=1
git diff --name-only main...HEAD | grep -Ev '^(src/(main\.ts|app/|ui/)|index\.html|public/|tests/(app|ui|integration|support)/|e2e/|\.github/workflows/|vite\.config\.ts$|playwright\.config\.ts$|package(-lock)?\.json$)'   # must print nothing
```

## Deliverables

1. `src/main.ts`, `src/app/**`, `src/ui/**`, `index.html` implementing the full application.
2. `tests/support/**` fakes and `tests/app|ui|integration/**`.
3. The production CSP, the GitHub Pages workflow (not triggered by you), and the Playwright
   `e2e/` tests with `playwright.config.ts`.
4. The Phase 4 QA report: the checklist, measurements (game fps with and without vision, vision
   fps, inference ms, gesture-to-jump latency), browsers and versions tested, known
   limitations, and proposed entries for `docs/decisions.md`.
5. A pushed `agent/integration-qa` branch with a draft pull request into `main`.

## Dependencies on other agents

- Phase 1 contracts: available now, so fakes and UI can start early.
- Agent 1's `createGame`, `createKeyboardInputSource` and `DEFAULT_KEY_BINDINGS`: needed for
  final wiring.
- Agent 2's `createVisionSession` and `isCameraSupported`, plus the model and WASM assets:
  needed for final wiring and CSP verification.
- Merge `main` into your branch after each Phase 2 merge.

## Known risks

- Double triggers from Enter on focused buttons; ArrowUp scrolling the page.
- Overlay misalignment with a mirrored video or `object-fit` cropping.
- A CSP that blocks MediaPipe (WASM compile, workers, blob URLs) or breaks dev HMR.
- Camera tracks left running after navigation (always test the browser indicator).
- Fakes drifting from real behaviour. Keep them faithful to the contract TSDoc and re-verify
  against the real modules in Phase 3.
- Auto-deploy publishes every merge; a workflow that skips `npm run check` would publish broken
  builds.
- Scope creep into game or vision internals. Escalate instead.

## Escalate to the orchestrator when

- The game or vision public API is missing something the UI needs (an ICR, or a request to the
  owning agent).
- You need to change files owned by Agents 1 or 2, a shared contract, or a root config file
  other than `vite.config.ts`.
- You want a dependency other than `@playwright/test`.
- The deployment setup cannot follow decision O-02, or CSP requirements conflict with privacy
  goals.
- QA finds defects in another agent's area. Report them with reproduction steps and do not fix
  them yourself.

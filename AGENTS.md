# AGENTS.md

Rules for every agent (the orchestrator, the Game Systems agent, the Vision and Gesture agent,
and the Integration, UI and QA agent) and for every human contributor. This is the only
`AGENTS.md` in the repository; `CLAUDE.md` just imports it.

- Design: [`docs/architecture.md`](docs/architecture.md)
- Phases, branches, worktrees and merging: [`docs/workflow.md`](docs/workflow.md)
- Decisions, risks and assumptions: [`docs/decisions.md`](docs/decisions.md)
- Task specifications: [`docs/tasks/`](docs/tasks/)

If a task specification conflicts with this file, this file wins. Stop and ask the orchestrator.

## Project overview

Vision Dino is a **two-player endless runner** inspired by the Chrome Dino game, delivered as a
**static website** with no backend, hosted on GitHub Pages.

- Two dinosaurs run in two lanes and face the same, synchronised obstacles.
- **Player 1 jumps by deliberately blinking. Player 2 jumps by deliberately opening their mouth.**
- One webcam captures both players. Face landmarks and gestures are computed **entirely in the
  browser**. Camera frames and face data never leave the device.
- **Keyboard controls are always available** (Player 1: `W`, Player 2: `↑`). They support
  development, testing and accessibility, and are the fallback when the camera or the model is
  unavailable.
- The game is fully playable and testable without a camera.

**Status:** complete (v1.0.0, 2026-09-15). All four phases are merged. The game engine, the
vision pipeline and the integrated application are on `main`, which deploys to
<https://hadissuryaalamin.github.io/vision-dino-chrome/> on every merge. Phase 4 closed after
manual two-player testing and the mouth-open tuning (F-02); see `docs/decisions.md` for the test
log and known limitations. Any future work starts from a new task specification.

## Stack and commands

TypeScript 6.0 (strict), Vite 8, HTML Canvas 2D, plain CSS, Vitest 5 (Node environment by
default, jsdom opt-in per file), ESLint 10 with type-aware typescript-eslint, Prettier 3, npm.
Node `^22.13.0 || ^24.0.0 || >=26.0.0` (the intersection of Vite, Vitest, ESLint and jsdom
requirements; Node 20 is not supported by Vitest 5).

| Command                     | Purpose                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `npm ci`                    | Install the exact locked dependencies (use in every fresh worktree).           |
| `npm run dev`               | Vite dev server at `http://localhost:5173/`.                                   |
| `npm run typecheck`         | `tsc --noEmit` over `src/`, `tests/` and the config files.                     |
| `npm run lint`              | ESLint, including the architecture-boundary and privacy rules.                 |
| `npm run lint:fix`          | ESLint with automatic fixes.                                                   |
| `npm run format:check`      | Prettier check (fails on unformatted files).                                   |
| `npm run format`            | Prettier write.                                                                |
| `npm test`                  | Vitest, single run.                                                            |
| `npm run test:watch`        | Vitest in watch mode.                                                          |
| `npx vitest run tests/game` | Run one directory or file of tests.                                            |
| `npm run build`             | Production build into `dist/` (static files).                                  |
| `npm run preview`           | Serve `dist/` at `http://localhost:4173/` to check the production build.       |
| `npm run check`             | **All gates:** typecheck, lint, format check, tests, build. Required for done. |

Camera access requires a secure context. `localhost` qualifies; a LAN IP over plain HTTP does not.

## Ownership

Edit only files you own. Everything else is read-only for you unless the orchestrator approves a
change.

| Owner                           | Paths                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Orchestrator                    | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/**`, `src/shared/**`, `tests/shared/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.gitattributes`, `vite.config.ts` (Phases 1–2)                     |
| Agent 1: Game Systems           | `src/game/**`, `tests/game/**`                                                                                                                                                                                                                                                                               |
| Agent 2: Vision and Gesture     | `src/vision/**`, `tests/vision/**`, `public/vision/**`                                                                                                                                                                                                                                                       |
| Agent 3: Integration, UI and QA | `src/main.ts`, `src/app/**`, `src/ui/**`, `index.html`, `public/**` except `public/vision/**`, `tests/app/**`, `tests/ui/**`, `tests/integration/**`, `tests/support/**`, `e2e/**` (including `e2e/playwright.config.ts` and `e2e/tsconfig.json`), `.github/workflows/**`, `vite.config.ts` (Phase 3 onward) |

Pre-approved exceptions:

- Agent 2 may add `@mediapipe/tasks-vision` to `package.json` and `package-lock.json` in one
  dedicated commit.
- Agent 3 may add `@playwright/test` (dev dependency) and a `test:e2e` script to `package.json`
  and `package-lock.json` in one dedicated commit in Phase 3 (decision O-05).
- Each agent may create a `README.md` inside its own module directory (for example
  `src/game/README.md`) to document its public interface.

## Architecture rules

1. **Game logic is independent of computer vision.** `src/game` never imports `src/vision`,
   `src/app`, `src/ui` or any `@mediapipe/*` package.
2. **The game accepts abstract player actions only.** It exposes `GameController`
   (`jumpPlayer(1)`, `jumpPlayer(2)`, `start`, `pause`, `resume`, `restart`) from
   `src/shared/game.ts`. It does not know whether a jump came from a key, a blink or a test.
3. **The vision module emits semantic gesture events** (`VisionEvent` in
   `src/shared/vision.ts`). A gesture is emitted **once per state transition**, never once per
   frame.
4. **The vision module never manipulates game state** and never imports `src/game`, `src/app`
   or `src/ui`.
5. **Only the integration layer (`src/app`) connects gestures to game actions.** It imports
   `src/game` and `src/vision` only through their public entry points (`index.ts`).
6. **`src/ui` renders data passed in by `src/app`.** It imports only `src/shared` and other UI
   modules.
7. **Only `src/vision` may access the camera** (`navigator.mediaDevices`, `getUserMedia`).
8. **`src/shared` is the dependency root.** It imports nothing else from `src/`, has no runtime
   dependencies and holds only contracts and tiny pure helpers.
9. **No global mutable state.** Create state in factories (`createGame`, `createVisionSession`,
   `createApp`) and pass it explicitly. Module-level constants must be immutable.
10. **Prefer explicit TypeScript interfaces** for every cross-module boundary. No `any` in public
    signatures.
11. **Keep modules testable through dependency injection.** Inject clocks, frame schedulers,
    random sources, `MediaDevices`, landmark detectors and event targets, and give each a
    production default.
12. **Automated tests never require a real camera, a real model or network access.**
13. **Game logic is deterministic.** No `Math.random` or `Date.now` in `src/game`. Use the
    injected seeded random source and scheduler time.

Rules 1, 4–8 and 13, and the privacy rules below, are enforced by `npm run lint`
(`eslint.config.js`). Never disable a boundary rule to make code pass. Escalate instead.

## Privacy and security rules

- **Never upload, store or transmit webcam frames.** All processing happens in the browser.
- **Do not record video or audio.** Request `audio: false`.
- **Do not save biometric or face-landmark data**, including calibration results, to
  `localStorage`, `sessionStorage`, IndexedDB, cookies, files or anywhere else. Keep it in memory
  for the session only.
- **Do not add analytics, telemetry or error reporting** that could capture camera-related
  information. The app makes no network requests except loading its own static assets.
- **Request camera permission only after an explicit user action**, such as clicking "Play with
  camera". Never on page load.
- **Stop every camera track** when camera mode ends: switching to keyboard-only mode, turning the
  camera off, closing the game, `pagehide`, and `destroy()`/`dispose()`.
- **Tell users clearly that processing is local.** Show this before the permission prompt and
  in the camera view.
- The model and WASM are self-hosted from the site's own origin under `public/vision/`
  (decision O-01). Any third-party runtime request needs a new orchestrator decision.
- MediaPipe 1.0.1 has built-in usage telemetry that cannot be switched off. It must stay
  blocked by a `connect-src 'self'` Content Security Policy in the production build and the
  Vision Lab (decision O-13). Never loosen `connect-src` to allow it.
- Never commit secrets, credentials, `.env` files, or recordings or images of real faces.
  Test fixtures use synthetic landmark data.

## Development rules

- **Inspect existing code before modifying it.** Read the relevant task specification, this file
  and `docs/architecture.md` first.
- **Modify only files in your ownership area.** Do not modify unrelated files, and do not
  reformat files you do not own.
- **Coordinate interface changes through the shared types.** Do not edit `src/shared/**`;
  submit an Interface Change Request to the orchestrator (`docs/workflow.md`).
- **Do not introduce major dependencies without documenting the reason** and getting orchestrator
  approval. The only pre-approved dependencies are `@mediapipe/tasks-vision` (Agent 2, runtime)
  and `@playwright/test` (Agent 3, dev).
- **Add or update tests for every behavioural change.** Bug fixes include a regression test.
- **Run the relevant validation** (`npm run check` before declaring done) and **report failures
  honestly**, with the output. Never mark failing work as done.
- Timestamps are milliseconds on the `performance.now()` clock (`TimestampMs`).
- Runtime asset URLs are built from `import.meta.env.BASE_URL`, never hard-coded as `/…`.
- **Maintain static-hosting compatibility.** No server code, no server-only features, no
  required custom HTTP headers.
- **Do not commit generated build output** (`dist/`, `coverage/`). Commit `package-lock.json`
  whenever dependencies change.
- Formatting is Prettier's job. Run `npm run format` on your own files only.

## Git rules

- **Each implementation agent works on its own branch in its own Git worktree:**
  `agent/game-systems`, `agent/vision-gestures`, `agent/integration-qa`
  (commands in `docs/workflow.md`).
- **Never commit directly to `main`.** Work reaches `main` through reviewed merges.
- **Keep commits focused**, using Conventional Commits with a scope, for example
  `feat(game): add fixed-step loop` or `test(vision): cover hysteresis band`. Put dependency
  changes in their own commit.
- **Never rewrite or delete unrelated user changes.** No `git reset --hard`, `git clean`,
  `git push --force`, `git checkout -- <path>`, `git stash drop` or branch deletion on work you
  did not create, unless the user explicitly asks.
- **Check for overlapping file modifications before integration.** Every changed path must be
  inside the branch owner's area (see the check in `docs/workflow.md`).
- **Integrate shared interfaces before dependent modules.** Contract changes land on `main`
  first; dependent branches then merge `main` in.
- Leave the unmerged remote branch `origin/copilot/browser-based-endless-runner` alone. It is a
  reference prototype for a different design.
- **Pushing and pull requests (decision O-12):** when your task is done and `npm run check`
  passes, push **your own** `agent/*` branch and open a **draft** pull request into `main`,
  with your report (format below) as the description. Never push to `main`, never mark your own
  pull request ready, and never merge it. The user or orchestrator reviews and merges.
- **Every merge into `main` deploys the site to GitHub Pages** (decision O-02), so `main` must
  always pass `npm run check`.

## Definition of done

A task is complete only when all of these hold:

1. Its acceptance criteria in `docs/tasks/…` are satisfied.
2. The relevant tests pass (`npm test`).
3. Type checking passes (`npm run typecheck`).
4. Linting passes (`npm run lint`) and formatting is clean (`npm run format:check`).
5. The production build succeeds (`npm run build`).
   Items 2–5 are exactly `npm run check`.
6. Camera-independent testing is still possible: no test needs a camera, a model or the network.
7. Public interfaces are documented in TSDoc on the module's `index.ts` (and its module
   `README.md` if it has one).
8. Known limitations, untested situations and failed or skipped checks are reported.

## When to stop and escalate to the orchestrator

- A shared contract in `src/shared/**` seems wrong or insufficient.
- You need to edit a file outside your ownership area.
- You want to add a dependency other than a pre-approved one.
- A lint boundary rule blocks a design you believe is correct.
- A privacy rule would be weakened, for example by a third-party request or persistence.
- Acceptance criteria conflict, or cannot be met on the target browsers.
- Validation fails for reasons outside your area.

## Agent report format

End every work session with a report containing: summary; files changed; public interfaces
added or changed; tests added; validation commands run with their results; manual checks done
(browser and version, camera model if relevant); known limitations; open questions and Interface
Change Requests. When the task is done, this report is the draft pull request's description.

# Task: Agent 1 — Game Systems

You are the **Game Systems agent** for Vision Dino, a two-player browser endless runner inspired
by the Chrome Dino game. Player 1 jumps by blinking and Player 2 by opening their mouth. Other
agents build the camera and gesture side. **You build the game itself, and it must be fully
playable with the keyboard and fully testable without a camera.**

Required reading before you start: `AGENTS.md` (rules, commands, definition of done),
`docs/architecture.md` §4–§7 and §11, and `src/shared/` (the contracts you implement).

## Goal

A deterministic, delta-time-safe, two-player endless-runner engine with a Canvas 2D renderer
and a keyboard input source. It implements the shared `GameController` contract and can be
played on a dev-only playground page.

## Branch and worktree

Work in the `agent/game-systems` branch, in the worktree `../dino-game-systems`
(`docs/workflow.md`). Run `npm ci` first. Never commit to `main`. When your task is done, push
`agent/game-systems` and open a draft pull request into `main` (`AGENTS.md`, Git rules).

## Owned files

- `src/game/**` (including `src/game/README.md` and the dev page `src/game/playground/**`)
- `tests/game/**`

## Do not modify

- `src/shared/**` and `tests/shared/**`: request changes through an Interface Change Request
- `src/vision/**`, `tests/vision/**`, `public/vision/**` (Agent 2)
- `src/app/**`, `src/ui/**`, `src/main.ts`, `index.html`, `public/**`, `tests/app|ui|integration|support/**` (Agent 3)
- `package.json`, `package-lock.json`, root config files, `AGENTS.md`, `docs/**` (orchestrator).
  No new dependencies are expected; escalate if you think you need one.

You must **not** implement or import anything related to the camera, face detection or
MediaPipe. Lint enforces this.

## Required interfaces

Implement these contracts from `src/shared` (read their TSDoc; the semantics are binding):

- `GameController`: `jumpPlayer(playerId)`, `start()`, `pause()`, `resume()`, `restart()`,
  `getSnapshot()`, `subscribe(listener)`
- `GameSnapshot`, `PlayerSnapshot`, `GameResult`, `GameEvent`, `GameStatus`
- `PlayerInputSource` and `PlayerAction` (for the keyboard adapter; `source: "keyboard"`)

Expose this public API from `src/game/index.ts`. Names are fixed because Agent 3 codes against
them; you may add optional fields.

```ts
import type { GameController, PerPlayer, PlayerInputSource } from "../shared";

export interface FrameScheduler {
  /** Like requestAnimationFrame: calls back with a performance.now()-based timestamp. */
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

export interface GameConfig {
  /* physics, speeds, spacing, scoring, fixedStepMs, maxFrameDeltaMs, jumpBufferMs,
     roundEnd: "all-crashed" | "first-crash", ... — your design, all documented */
}
export const DEFAULT_GAME_CONFIG: Readonly<GameConfig>;

export interface GameEngineOptions {
  /** Fixed seed makes rounds reproducible. Default: a random seed from crypto.getRandomValues. */
  seed?: number;
  config?: Partial<GameConfig>;
}

/** Your internal engine state type (players, obstacles, speed, ...). Export it as a type. */
export interface GameState {
  /* your design */
}

/** Headless engine: no DOM, no timers. The unit-testing entry point. */
export interface GameEngine extends GameController {
  /** Advance by a real-time delta; clamped to maxFrameDeltaMs and split into fixed steps. */
  advance(dtMs: number): void;
  /** Full internal state for the renderer and tests. Read-only by convention. */
  getState(): Readonly<GameState>;
}
export function createGameEngine(options?: GameEngineOptions): GameEngine;

export interface CreateGameOptions extends GameEngineOptions {
  canvas: HTMLCanvasElement;
  /** Default: requestAnimationFrame-based. Tests pass a manual scheduler. */
  scheduler?: FrameScheduler;
}
export interface GameHandle extends GameController {
  /** Stop the loop and remove every listener or observer created by createGame. */
  destroy(): void;
}
export function createGame(options: CreateGameOptions): GameHandle;

/** KeyboardEvent.code values that make each player jump. */
export type KeyBindings = PerPlayer<readonly string[]>;
export const DEFAULT_KEY_BINDINGS: KeyBindings; // { 1: ["KeyW"], 2: ["ArrowUp"] }

export interface KeyboardInputOptions {
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  bindings?: KeyBindings;
}
export function createKeyboardInputSource(options: KeyboardInputOptions): PlayerInputSource;
```

## Implementation steps

1. **Read the contracts** in `src/shared/game.ts` and `src/shared/input.ts`. List any gaps as
   ICRs before coding around them.
2. **Config and PRNG.** In `src/game/config.ts`, define `GameConfig` and `DEFAULT_GAME_CONFIG`
   in world units (for example a logical lane width of 900 units), with physics in units per
   second. In `src/game/random.ts`, write a small seeded PRNG (for example mulberry32). No
   `Math.random` or `Date.now` anywhere in `src/game`; lint enforces this.
3. **Engine state** (`src/game/engine/`): the round status machine
   (`ready → running ⇄ paused → game-over`, and `restart()` from any state to `running`),
   per-player state (y, vertical velocity, grounded, crashed, score, pending jump time), world
   distance and speed, and one shared obstacle list.
4. **Physics:** gravity, jump impulse and ground detection with clamping (never below ground).
   No double jump. Honour `jumpBufferMs`: a request made while airborne within that window
   before landing fires on landing. `jumpPlayer` takes effect on the next fixed step, and is
   ignored when not `running` or when crashed.
5. **Obstacles:** spawn from the seeded PRNG into **one sequence shared by both lanes**, so both
   players see identical obstacles at the same world positions. Use only ground obstacles one
   jump can clear. Enforce a minimum gap that grows with speed:
   `gap ≥ speed × (airtime + reactionAllowance)`, with `reactionAllowance` ≈ 0.35 s for vision
   latency. Remove obstacles once they leave the screen. Speed ramps up to a maximum.
6. **Collision:** axis-aligned boxes with a small forgiving inset, per player. A crash freezes
   that player's score and emits `player-crashed` once.
7. **Scoring and round end:** score grows with distance while alive. With `roundEnd:
"all-crashed"` (default; decision O-03) the round ends when both players have crashed.
   `first-crash` ends it at the first crash. Build the `GameResult`: higher score wins, and a
   tie gives `winner: null`. Emit `game-over` once.
8. **Events and snapshot:** emit `status-changed`, `player-jumped`, `player-crashed` and
   `game-over` synchronously after each change. `getSnapshot()` returns an immutable object
   that is replaced when the state changes (do not allocate on every call).
9. **Fixed-step loop** (`src/game/loop/`): accumulator with `fixedStepMs` (≈ 8.33 ms),
   `maxFrameDeltaMs` clamp (≈ 100 ms) and an injected `FrameScheduler`. Avoid drift from
   floating-point accumulation, for example by accumulating integer microseconds.
10. **Renderer** (`src/game/render/`): a pure function of engine state onto a
    `CanvasRenderingContext2D`. Draw two stacked lanes (Player 1 on top), ground, dinosaurs,
    obstacles, a crashed state (greyed lane), a "P1 · blink" / "P2 · mouth" lane label, a short
    visual cue when a player jumps, and scores. Handle `devicePixelRatio` and resize (a
    `ResizeObserver` inside `createGame`, disconnected in `destroy()`). Colour must not be the
    only way players are distinguished: use text labels as well. The renderer must never
    mutate state.
11. **`createGame`**: compose the engine, loop and renderer on the given canvas. `destroy()`
    cancels the scheduled frame and removes the observers and listeners.
12. **Keyboard adapter** (`src/game/input/`): `keydown` → `JumpAction` with `source:
"keyboard"` and `timestamp: event.timeStamp`. Ignore `event.repeat`, events with
    Ctrl/Alt/Meta held, and events whose target is editable (`input`, `textarea`, `select`,
    `contenteditable`). Call `preventDefault()` for bound keys (stops ArrowUp from scrolling).
    `start()` and `stop()` are idempotent; `stop()` removes the listener. The adapter never
    calls the engine; it only emits actions. App-level keys (Enter, P, Escape, `` ` ``) belong
    to Agent 3.
13. **Playground** (`src/game/playground/index.html` + `main.ts`, dev only, at
    `http://localhost:5173/src/game/playground/`): canvas + `createGame` + the keyboard source,
    with the jump subscription calling `jumpPlayer`. Enter starts or restarts, P pauses or
    resumes, and on-page text lists the controls. It is not in the production build.
14. **Document** the public API with TSDoc in `src/game/index.ts` and a short
    `src/game/README.md` (config fields, determinism guarantees, how to test).

## Acceptance criteria

- [ ] `npm run check` passes.
- [ ] The playground is playable by two people on one keyboard (`W` and `↑`): both dinos run in
      stacked lanes, jump, land, collide, score, reach game over and restart.
- [ ] Both lanes receive an identical obstacle sequence; every generated sequence is clearable
      by a perfect player.
- [ ] Determinism: the same seed and the same sequence of `advance`/`jumpPlayer` calls give a
      deeply equal state.
- [ ] Frame-rate independence: simulating the same real time at 30, 60 and 144 Hz (with the
      same jump times) gives the same outcome.
- [ ] Frame deltas above `maxFrameDeltaMs` are clamped (no teleporting through obstacles after
      a tab switch).
- [ ] `jumpPlayer` is ignored when not running, after a crash and while airborne (except
      within the buffer). It never throws. No double jump.
- [ ] Every event is emitted exactly once per occurrence and in a sensible order
      (`player-crashed` before `game-over`).
- [ ] The keyboard adapter ignores auto-repeat, so holding a key produces one jump.
- [ ] `createGame(...).destroy()` leaves no scheduled frames or observers (verified with a manual
      scheduler and spies).
- [ ] No imports of vision, app, ui or MediaPipe; no camera access; no `Math.random` or
      `Date.now` (lint clean).
- [ ] Public API as specified above, documented in TSDoc and `src/game/README.md`.

## Required tests (`tests/game/**`, Node environment unless noted)

- Physics: jump arc, apex, landing, ground clamp, no double jump, jump buffer inside and outside
  the window.
- Status machine: every transition, and every ignored command in every state.
- Obstacles: seeded determinism, identical sequences for both lanes, minimum gap versus speed,
  removal off screen, a clearability simulation over many seeds.
- Collision: edge contact with the inset, near misses, collision during a jump.
- Scoring and results: score freeze on crash, both round-end modes, winner and tie.
- Restart: resets everything and derives a new seed deterministically.
- Pause: elapsed time and positions frozen; resume continues.
- Loop: fixed-step accumulation, clamping, frame-rate independence, manual scheduler.
- Events: exactly-once emission and unsubscribe behaviour.
- Keyboard adapter: bindings, repeat ignored, modifiers ignored, editable targets ignored,
  `preventDefault`, `stop()` removes the listener, idempotent start and stop (plain
  `EventTarget` + `Event`, or `// @vitest-environment jsdom`).
- Renderer smoke test: renders every status with a recording fake 2D context, does not throw,
  does not mutate state.

## Validation commands

```bash
npm ci
npx vitest run tests/game
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run check          # all gates; required before reporting done
npm run dev            # manual: http://localhost:5173/src/game/playground/
git diff --name-only main...HEAD | grep -Ev '^(src/game/|tests/game/)'   # must print nothing
```

## Deliverables

1. The `src/game/**` implementation with the public API above.
2. `tests/game/**` covering the required tests.
3. The dev playground page.
4. `src/game/README.md`.
5. A report in the `AGENTS.md` format, including tuned default values, anything you could not
   make deterministic, and any ICRs.

## Dependencies on other agents

- Needs only the Phase 1 contracts in `src/shared` (already on `main`).
- Agent 3 will consume `createGame`, `createKeyboardInputSource`, `DEFAULT_KEY_BINDINGS` and
  `DEFAULT_GAME_CONFIG`. Keep those names stable.
- Independent of Agent 2. Never wait on vision work.

## Known risks

- Floating-point drift breaking frame-rate independence (use integer time accumulation).
- Difficulty tuned for keyboard feels unfair with vision latency of ~150–250 ms. Keep the
  reaction allowance and `jumpBufferMs` configurable, and note your chosen values.
- Canvas sizing and DPR bugs on high-DPI screens.
- Visual design that relies on colour alone.

## Escalate to the orchestrator when

- A shared contract (for example `GameSnapshot` or `GameEvent`) cannot express something the game
  needs.
- You need a dependency or a change to files outside `src/game/**` and `tests/game/**`.
- A lint rule blocks a legitimate need (for example `performance.now` in the default scheduler
  is fine, but ask about anything else).
- The lane layout needs a product decision (the round-end rule is already decided: O-03).

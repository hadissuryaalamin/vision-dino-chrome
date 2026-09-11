# `src/game` — Game Systems

A deterministic, keyboard-playable, two-player endless runner. Two dinosaurs run in two
stacked lanes (Player 1 on top, "P1 · blink"; Player 2 below, "P2 · mouth") and face **one
shared, seeded obstacle sequence**. The module implements the `GameController` contract from
`src/shared/game.ts` and knows nothing about cameras, faces or gestures.

Import only from `src/game/index.ts`.

## Public API

| Export                                                                                              | Purpose                                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `createGame({ canvas, seed?, config?, scheduler?, ... })`                                           | Engine + fixed-step loop + Canvas 2D renderer. Returns a `GameHandle` (`destroy()`).   |
| `createGameEngine({ seed?, config?, onListenerError? })`                                            | Headless engine: `advance(dtMs)`, `getState()`, `config`, plus `GameController`.       |
| `createKeyboardInputSource({ target, bindings? })`                                                  | `PlayerInputSource` from `keydown`; emits `JumpAction`s with `source: "keyboard"`.     |
| `DEFAULT_GAME_CONFIG`, `resolveGameConfig(overrides)`                                               | Tuned defaults; merge and validate overrides (throws `RangeError` for unfair configs). |
| `DEFAULT_KEY_BINDINGS`                                                                              | `{ 1: ["KeyW"], 2: ["ArrowUp"] }` (`KeyboardEvent.code`).                              |
| `createAnimationFrameScheduler`, `createManualFrameScheduler`                                       | Production and hand-driven `FrameScheduler`s.                                          |
| `renderGame(ctx, state, config, viewport, options?)`                                                | Pure renderer (used by `createGame`; exported for tools and tests).                    |
| `jumpAirtimeMs`, `jumpApexHeight`, `timeAboveHeightMs`, `isObstacleClearable`, `minimumGap`         | Closed-form tuning helpers.                                                            |
| Types: `GameState`, `PlayerState`, `ObstacleState`, `CrashState`, `GameConfig`, `ObstacleKind`, ... | See TSDoc in the sources.                                                              |

Wiring (the application layer does this; the adapter never calls the game):

```ts
const game = createGame({ canvas });
const keyboard = createKeyboardInputSource({ target: window });
keyboard.subscribe((action) => game.jumpPlayer(action.playerId));
keyboard.start();
// later: keyboard.stop(); game.destroy();
```

Size the canvas with CSS (for example `width: 100%; aspect-ratio: 900 / 560`). `createGame`
sets the backing store to CSS size × `devicePixelRatio`, follows a `ResizeObserver`, and
re-reads the pixel ratio every frame. A canvas without CSS size keeps its initial `width` and
`height` attributes as its CSS size.

## Rules and semantics

- **Status machine:** `ready → running ⇄ paused → game-over`. `start()` only from `ready`,
  `pause()` only from `running`, `resume()` only from `paused`; anything else is ignored.
  `restart()` works from any state, enters `running` and emits one `status-changed` whose
  `previous` may also be `running`.
- **Jumps:** `jumpPlayer(id)` is applied at the start of the next fixed step, only while
  `running` and not crashed. No double jump. An airborne request made at most `jumpBufferMs`
  before landing fires on the landing step (only the latest airborne request counts).
- **Obstacles:** ground obstacles only, each clearable by one jump (validated at config time).
  The edge-to-edge gap after an obstacle is at least
  `projectedSpeed × (airtime + reactionAllowance)` plus a random extra. `projectedSpeed` is an
  upper bound on the speed the world can reach before the dinosaur has crossed that gap, so a
  perfect player always gets at least `reactionAllowanceMs` on the ground between jumps even
  while the game speeds up. Obstacles are created just off the right edge and removed once
  they have left on the left.
- **Collision:** axis-aligned boxes, both shrunk by `collisionInset` on every side; touching
  edges do not count. A crash freezes the player's score, freezes that lane's picture (it is
  drawn greyed out with "P*n* CRASHED") and emits `player-crashed` once.
- **Scoring:** `floor(distance × scorePerUnit)` for each surviving player.
- **Round end (O-03):** `roundEnd: "all-crashed"` (default) ends when both players have
  crashed; `"first-crash"` at the first crash. The higher score wins. On equal scores the
  player who crashed later (or did not crash) wins, so the last dino still running wins even
  when both scores round to the same integer. `winner` is `null` only when both crashed in
  the same step with equal scores (ICR 1).
- **Events** are synchronous and emitted after the change. Within a step: `player-jumped`,
  then `player-crashed`, then `status-changed` (→ `game-over`), then `game-over`. A throwing
  listener does not break the step; its error goes to `onListenerError` (default: rethrown
  asynchronously).
- **Snapshots:** `getSnapshot()` returns a frozen object, rebuilt lazily only after a change.

## Determinism guarantees

- No `Math.random`, no `Date.now` (lint-enforced). Obstacles come from a mulberry32 PRNG whose
  32-bit state lives in `GameState`, so state is plain, comparable data.
- Same seed + same sequence of `advance`/`jumpPlayer`/commands ⇒ deeply equal `GameState`.
- `restart()` draws the next round's seed from a separate seed stream derived from the initial
  seed, so it does not depend on how the previous round went.
- **Fixed step:** 1/120 s, rounded to whole microseconds (8333 µs). Frame deltas are clamped to
  `maxFrameDeltaMs`, converted to whole microseconds with the rounding remainder carried
  forward, and accumulated as integers. Feeding the same real time at 30, 60, 120 or 144 Hz, or
  in irregular frames, yields the same steps, so the same states at the same times (tested).
- Physics integrates the exact parabola per step (`y += vy·dt − g·dt²/2`).
- The only non-deterministic input is the default seed (`crypto.getRandomValues`) when no seed
  is given.

## Configuration (defaults)

World units: one lane is 900 × 280 units. Speeds in units/s, durations in ms.

| Field                 | Default       | Notes                                                                        |
| --------------------- | ------------- | ---------------------------------------------------------------------------- |
| `laneWidth`           | 900           | Visible lane width.                                                          |
| `laneHeight`          | 280           | Rendering only.                                                              |
| `groundY`             | 240           | Ground line from the top of the lane (rendering only).                       |
| `dinoX`               | 80            | Dinosaur's left edge.                                                        |
| `dinoWidth`           | 60            |                                                                              |
| `dinoHeight`          | 64            |                                                                              |
| `gravity`             | 3500          | units/s².                                                                    |
| `jumpVelocity`        | 960           | ⇒ airtime ≈ 549 ms, apex ≈ 132 units.                                        |
| `startSpeed`          | 450           | The lane shows 2 s of track at the start.                                    |
| `maxSpeed`            | 1000          | Reached after ≈ 79 s.                                                        |
| `acceleration`        | 7             | units/s².                                                                    |
| `obstacleKinds`       | 5 cacti       | 26–78 wide, 52–76 tall; the widest two appear from 550 / 650 units/s.        |
| `firstObstacleX`      | 1300          | First obstacle reached after ≈ 2.4 s.                                        |
| `spawnMargin`         | 100           | Created this far past the right edge.                                        |
| `reactionAllowanceMs` | 350           | Vision latency allowance in the minimum gap (≈ 150–250 ms latency + margin). |
| `gapRandomExtraMs`    | 900           | Extra gap up to `speed × 0.9 s`.                                             |
| `collisionInset`      | 6             | Forgiving hit boxes.                                                         |
| `scorePerUnit`        | 0.025         | ≈ 11 points/s at the start.                                                  |
| `roundEnd`            | `all-crashed` | O-03.                                                                        |
| `fixedStepMs`         | 8.333…        | 1000 / 120.                                                                  |
| `maxFrameDeltaMs`     | 100           |                                                                              |
| `jumpBufferMs`        | 100           | Forgives gestures that arrive slightly before landing.                       |

## Testing

- `npx vitest run tests/game` — engine, loop, renderer, keyboard and `createGame` tests. No
  DOM needed except `keyboard.test.ts` (jsdom). `createGame` is tested with a fake canvas,
  a fake `ResizeObserver` and `createManualFrameScheduler()`.
- `tests/game/helpers.ts` contains a "perfect player" used for the clearability simulation.
- Manual: `npm run dev`, then open `http://localhost:5173/src/game/playground/` (dev only,
  not in the production build). `W` and `↑` jump, `Enter` starts or restarts, `P` pauses.
  URL options: `?seed=123`, `?roundEnd=first-crash`.

## Known limitations

- Visual design is deliberately simple (rectangles). Colour is never the only cue: lanes carry
  text labels, and each dinosaur shows its player number.

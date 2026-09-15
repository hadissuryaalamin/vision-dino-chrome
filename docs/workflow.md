# Workflow: phases, branches, worktrees and integration

## Roles

| Role                            | Branch                  | Worktree directory (sibling of this repo) | Task spec                           |
| ------------------------------- | ----------------------- | ----------------------------------------- | ----------------------------------- |
| Orchestrator                    | `main`, via review      | this repository (`E:\vision-dino-chrome`) | this document                       |
| Agent 1: Game Systems           | `agent/game-systems`    | `../dino-game-systems`                    | `docs/tasks/agent-1-game.md`        |
| Agent 2: Vision and Gesture     | `agent/vision-gestures` | `../dino-vision-gestures`                 | `docs/tasks/agent-2-vision.md`      |
| Agent 3: Integration, UI and QA | `agent/integration-qa`  | `../dino-integration-qa`                  | `docs/tasks/agent-3-integration.md` |

## Phases

### Phase 1: Shared contracts (orchestrator) — done (merged in PR #2)

- Tooling: npm, TypeScript, Vite, Vitest, ESLint (with boundary rules), Prettier.
- Contracts in `src/shared/`, pinned by `tests/shared/contracts.test.ts`.
- A placeholder `index.html` and `src/main.ts` so the build works.
- Documentation: `AGENTS.md`, `docs/`.
- **Exit:** `npm run check` passes, and Phase 1 is committed to `main` (see "Landing Phase 1").
  The agent branches are created from that commit.

### Phase 2: Parallel implementation (Agents 1 and 2) — done (PRs #3 and #5)

- Agent 1 builds the keyboard-playable game, playable at `/src/game/playground/` in
  `npm run dev`.
- Agent 2 builds the standalone camera and gesture diagnostic page (Vision Lab) at
  `/src/vision/lab/`.
- Both work only against `src/shared` and never import each other's modules.
- **Optional early start for Agent 3:** once Phase 1 is on `main`, Agent 3 may build fakes
  (`tests/support/`), the input router, the vision input adapter and the UI screens against the
  contracts. It must not wire up the real game or vision modules until they are merged.
- **Exit:** each agent pushes its branch and opens a **draft pull request** into `main`
  (decision O-12). The branch must pass `npm run check`, its acceptance criteria and the
  ownership check; the user or orchestrator reviews it, marks it ready and merges. Merge order:
  **game first** (no dependencies), then **vision** (adds `@mediapipe/tasks-vision` and assets).

### Phase 3: Integration (Agent 3) — done (PR #7; first deployment succeeded)

- Merge `main` into `agent/integration-qa` after both Phase 2 branches have landed.
- Wire `createGame`, `createKeyboardInputSource`, `createVisionSession` and
  `createVisionInputSource` in `src/app`. Add the permission flow, positioning, calibration,
  instructions, error and fallback screens, the debug overlay, the responsive layout and
  accessibility.
- Add the production CSP, the GitHub Pages workflow that deploys on every push to `main`
  (decision O-02), and the Playwright end-to-end tests (decision O-05).
- **Exit:** `npm run check` passes, integration tests pass with fakes, and a manual smoke test
  in `npm run preview` works with a real camera.

### Phase 4: Review and stabilisation (Agent 3 leads; orchestrator reviews)

Run and record, in the agent report and `docs/decisions.md`:

- [ ] Unit and integration tests (`npm run check`).
- [ ] Keyboard-only mode end to end, with the camera never requested.
- [ ] Zero, one and two faces visible: positioning gating, messages, assignment labels.
- [ ] Camera permission denied, and permission revoked while running.
- [ ] Camera missing, or in use by another application.
- [ ] Model or WASM load failure (e.g. rename the asset in a local build).
- [ ] A face temporarily lost and reacquired: one `face-lost`, one `face-found`, no spurious
      gesture.
- [ ] Players crossing positions; the swap and reset controls.
- [ ] Held blink and held mouth-open: exactly one jump each; no repeated events.
- [ ] Rapid deliberate gestures: cooldown behaviour feels acceptable.
- [ ] Involuntary blinking over 60 s: count the false jumps.
- [ ] Mirrored and unmirrored preview: Player 1 is the face on the left of the preview in both.
- [ ] Static production build served with `npm run preview`, including assets under a sub-path.
- [ ] Camera tracks stop (the browser's camera indicator turns off) after keyboard switch,
      camera off, and closing or navigating away from the tab.
- [ ] Performance: game fps with vision on and off, vision fps, inference ms, gesture-to-jump
      latency.
- [ ] Network panel in camera mode: no request to `odml.pa.googleapis.com` or any other
      third-party host in the production build (decision O-13).
- [ ] Browsers and versions tested; anything untested is listed as a limitation.

**Phase 4 closed on 2026-09-15** by the user after manual two-player testing of the live build.
The checklist above was not recorded item by item; what was tested and what remains
unmeasured is in the `docs/decisions.md` test log and known limitations.

## Git worktree strategy

A **worktree** is an extra working directory attached to the same repository. Each worktree
has its own branch checked out and its own files and `node_modules`, but they all share one
object database and history. Agents can therefore edit, build and test in parallel without
touching each other's files. A branch can be checked out in only one worktree at a time.

Verified on 2026-09-11: this is a Git repository (`origin` =
`github.com/hadissuryaalamin/vision-dino-chrome`); the only local branch is `main`; the branches
`agent/*` and the directories `E:\dino-*` do not exist. **No branches or worktrees were
created during setup.** Create them only when Phase 2 starts.

### Landing Phase 1 (user or orchestrator, when approved)

```bash
git switch -c setup/phase-1-contracts
git add -A
git commit -m "chore: set up tooling, shared contracts and agent workflow docs"
# Merge through a pull request, or locally once reviewed:
git switch main
git merge --ff-only setup/phase-1-contracts
```

### Creating the agent worktrees (start of Phase 2)

```bash
git switch main
git pull --ff-only            # if main is tracked on origin

git branch agent/game-systems main
git branch agent/vision-gestures main
git branch agent/integration-qa main

git worktree add ../dino-game-systems agent/game-systems
git worktree add ../dino-vision-gestures agent/vision-gestures
git worktree add ../dino-integration-qa agent/integration-qa   # when Agent 3 starts

git worktree list
```

In each new worktree, run `npm ci` before anything else. `git worktree add -b <branch> <dir>
main` creates the branch and the worktree in one step.

If agents run as Claude Code subagents, the Agent tool's `isolation: "worktree"` option creates
temporary worktrees automatically. It is an alternative to the manual commands above; the
branch and ownership rules still apply.

### Keeping branches current

```bash
git fetch origin                # if using the remote
git merge main                  # inside the agent worktree, after contract changes land
```

Prefer merging `main` into agent branches over rebasing shared branches. Never force-push a
branch someone else uses.

### Cleaning up (only after the branch is merged)

```bash
git worktree remove ../dino-game-systems      # refuses if there are uncommitted changes
git branch -d agent/game-systems              # refuses if not merged
```

## Integration procedure (orchestrator)

1. **Ownership check:** every changed path must belong to the branch owner.

   ```bash
   git diff --name-only main...agent/game-systems   | grep -Ev '^(src/game/|tests/game/)'
   git diff --name-only main...agent/vision-gestures | grep -Ev '^(src/vision/|tests/vision/|public/vision/|package(-lock)?\.json$)'
   git diff --name-only main...agent/integration-qa  | grep -Ev '^(src/(main\.ts|app/|ui/)|index\.html|public/|tests/(app|ui|integration|support)/|e2e/|\.github/workflows/|vite\.config\.ts$|playwright\.config\.ts$|package(-lock)?\.json$)'
   ```

   No output means the branch stayed inside its area. Any output needs review. (Files under
   `public/vision/` changed by Agent 3 still count as violations; check by eye.)

2. **Overlap check** between two branches (Git Bash):

   ```bash
   comm -12 <(git diff --name-only main...agent/game-systems | sort) \
            <(git diff --name-only main...agent/vision-gestures | sort)
   ```

3. In the branch's worktree: `npm ci && npm run check`, and confirm the task's acceptance
   criteria from its report.
4. Mark the agent's draft pull request ready and merge it on GitHub, or merge locally with
   `git merge --no-ff <branch>` and push. Run `npm run check` again on `main`. Once the Pages
   workflow exists, **every merge deploys the site** (decision O-02), so never merge a branch
   that fails its checks.
5. Tell the other agents to `git merge main`.

**Lockfile conflicts:** never hand-edit `package-lock.json`. Take `main`'s version, re-run
`npm install <the branch's added packages>`, then commit.

## Interface Change Request (ICR)

Only the orchestrator edits `src/shared/**`. An agent that needs a contract change stops that
part of the work and sends:

```text
ICR: <short title>
Requested by: <agent>
Change: <exact type or signature diff>
Reason: <why the current contract is insufficient>
Compatibility: additive | breaking
Affected: <modules and agents>
```

The orchestrator applies the change on `main` in a small commit, updating `src/shared/**`,
`tests/shared/contracts.test.ts` and `docs/architecture.md` §6, and notifies all agents to merge
`main`. Additive changes are preferred.

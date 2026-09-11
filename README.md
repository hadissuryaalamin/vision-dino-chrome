# vision-dino-chrome

**Vision Dino** is a two-player endless runner inspired by the Chrome Dino game. One webcam sees
both players: **Player 1 jumps by blinking, Player 2 jumps by opening their mouth.** Face
tracking runs entirely in your browser, and no video is uploaded or saved. Keyboard controls
(`W` and `↑`) always work as well.

> **Status:** project setup (Phase 1). The tooling, shared contracts and development plan are
> in place. The game and the camera controls are not implemented yet.

## Development

Requires Node `^22.13.0 || ^24.0.0 || >=26.0.0`.

```bash
npm ci            # install
npm run dev       # dev server at http://localhost:5173/
npm run check     # typecheck, lint, format check, tests, production build
```

- Contributor and agent rules: [`AGENTS.md`](AGENTS.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Workflow and phases: [`docs/workflow.md`](docs/workflow.md)
- Decisions and risks: [`docs/decisions.md`](docs/decisions.md)
- Agent task specifications: [`docs/tasks/`](docs/tasks/)

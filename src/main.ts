// Phase 1 placeholder so the static build has an entry point. The Integration, UI and QA
// agent replaces this with the real application bootstrap (docs/tasks/agent-3-integration.md).
const root = document.querySelector<HTMLElement>("#app");

if (root) {
  root.textContent = "Vision Dino is in its setup phase. The game has not been implemented yet.";
}

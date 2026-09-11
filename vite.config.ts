import { defineConfig } from "vite";

// Build and deployment settings. Owned by the orchestrator in Phase 1 and by the
// Integration, UI and QA agent from Phase 3 (see AGENTS.md, "Ownership").
export default defineConfig({
  // Relative asset URLs keep the static build working from any sub-path
  // (e.g. GitHub Pages project sites). Runtime asset URLs must be built from
  // import.meta.env.BASE_URL, never hard-coded as "/...".
  base: "./",
});

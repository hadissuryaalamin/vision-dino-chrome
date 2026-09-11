import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so test settings (orchestrator-owned) and
// build/deployment settings (Integration agent from Phase 3) change independently.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Game and vision logic must be testable without a browser or a camera, so the
    // default environment is Node. DOM tests opt in per file with the comment
    // `// @vitest-environment jsdom` on the first line.
    environment: "node",
    restoreMocks: true,
    unstubGlobals: true,
  },
});

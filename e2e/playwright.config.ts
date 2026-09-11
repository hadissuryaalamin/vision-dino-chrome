import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (decision O-05): Chromium only, against the production build served by
// `vite preview` under the GitHub Pages project sub-path, with Chromium's fake camera.
// Run with `npm run test:e2e`. Deliberately not part of `npm run check`, which stays
// browser-free.

const PORT = 4173;
const BASE_PATH = "/vision-dino-chrome/";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "../test-results",
  // One browser at a time: the machine running this has limited memory, and the camera
  // tests load the ~16 MB MediaPipe runtime and model.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: "retain-on-failure",
    launchOptions: {
      // Grant camera permission automatically and use a synthetic camera (no faces).
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium" }],
  webServer: {
    // Build, then serve dist/ from the sub-path to prove relative asset URLs work there.
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort --base ${BASE_PATH}`,
    cwd: "..",
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

import { expect, test } from "@playwright/test";
import { observePage, readProbe } from "./support";

const TELEMETRY_HOST = "odml.pa.googleapis.com";

// Decision O-13: @mediapipe/tasks-vision 1.0.1 POSTs usage telemetry to
// https://odml.pa.googleapis.com/v1/log every 60 s while a task is loaded, and when it is
// closed. The production CSP (connect-src 'self') must block it.
//
// The app closes the model only in destroy() (VisionSession.dispose()); Keyboard only, camera
// off and pagehide call stop(), which keeps the model loaded. So this test waits in camera mode
// for the periodic upload: it takes a little over 60 s and has its own longer timeout. It runs
// only in `npm run test:e2e`, never in `npm run check`.
test("MediaPipe's telemetry upload is blocked by the production CSP (O-13)", async ({ page }) => {
  test.setTimeout(240_000);
  const observed = await observePage(page);

  // Safety net: a request the CSP failed to block would reach Playwright's network layer here.
  // It is aborted so nothing leaves the machine, and the test fails below.
  const reachedNetwork: string[] = [];
  await page.route(`https://${TELEMETRY_HOST}/**`, async (route) => {
    reachedNetwork.push(route.request().url());
    await route.abort();
  });
  const failedRequests: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes(TELEMETRY_HOST)) {
      failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? "no error text"})`);
    }
  });
  const finishedRequests: string[] = [];
  page.on("requestfinished", (request) => {
    if (request.url().includes(TELEMETRY_HOST)) finishedRequests.push(request.url());
  });

  await page.goto("./");
  await page.getByRole("button", { name: "Play with camera" }).click();
  await expect(page.getByRole("heading", { name: "Get into position" })).toBeVisible({
    timeout: 90_000,
  });
  const loadedAt = Date.now();

  const telemetryViolations = async () =>
    (await readProbe(page)).cspViolations.filter((violation) => violation.includes(TELEMETRY_HOST));
  await expect.poll(telemetryViolations, { timeout: 150_000, intervals: [2_000] }).not.toEqual([]);

  const violations = await telemetryViolations();
  const refusals = observed.consoleErrors.filter((error) => error.includes(TELEMETRY_HOST));
  console.log(
    [
      `telemetry blocked ${Math.round((Date.now() - loadedAt) / 1000)} s after the model loaded`,
      `securitypolicyviolation: ${violations.join(" | ")}`,
      `console: ${refusals.join(" | ") || "none"}`,
      `requestfailed: ${failedRequests.join(" | ") || "none"}`,
    ].join("\n"),
  );

  // Blocked by connect-src, never sent, never answered.
  expect(violations.every((violation) => violation.startsWith("connect-src "))).toBe(true);
  expect(reachedNetwork).toEqual([]);
  expect(finishedRequests).toEqual([]);
  expect(observed.externalRequests).toEqual([]);
});

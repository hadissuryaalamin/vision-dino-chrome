import { expect, test, type Page } from "@playwright/test";
import { observePage, readProbe, unexpectedViolations, type PageObservations } from "./support";

// Chromium's fake camera grants permission and shows a synthetic picture with no faces, so
// these tests reach the positioning screen but cannot calibrate or play with gestures.

/** Installs the probes (getUserMedia, streams, CSP), then clicks through to positioning. */
async function reachPositioning(page: Page): Promise<PageObservations> {
  const observed = await observePage(page);
  await page.goto("./");
  expect((await readProbe(page)).getUserMedia).toEqual([]);
  await page.getByRole("button", { name: "Play with camera" }).click();
  // Loads the self-hosted MediaPipe runtime and model under the production CSP.
  await expect(page.getByRole("heading", { name: "Get into position" })).toBeVisible({
    timeout: 90_000,
  });
  // The probe saw the stream, so the "all tracks stopped" checks below are meaningful.
  expect((await readProbe(page)).liveTracks).toBeGreaterThan(0);
  return observed;
}

test.describe("camera permission granted (fake camera)", () => {
  test("loads the self-hosted model under the CSP and reaches positioning", async ({ page }) => {
    const observed = await reachPositioning(page);

    const probe = await readProbe(page);
    expect(probe.getUserMedia).toHaveLength(1);
    expect(probe.getUserMedia[0]?.audio).toBe(false);
    expect(probe.liveTracks).toBeGreaterThan(0);

    const camera = page.getByRole("complementary", { name: "Camera" });
    await expect(camera).toBeVisible();
    await expect(camera.locator("video")).toHaveAttribute("playsinline", "");
    await expect(page.getByText(/No faces detected yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();

    // The model and WASM came from the preview server, and nothing else left the machine.
    expect(
      observed.requests.some((url) =>
        url.includes("/vision-dino-chrome/vision/face_landmarker.task"),
      ),
    ).toBe(true);
    expect(observed.requests.some((url) => /vision_wasm\w*_internal-[\w-]+\.wasm/.test(url))).toBe(
      true,
    );
    expect(observed.externalRequests).toEqual([]);
    expect(unexpectedViolations(probe.cspViolations)).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
  });

  test("ignores ?vision=simulated in the production build", async ({ page }) => {
    const observed = await observePage(page);
    await page.goto("./?vision=simulated");
    await page.getByRole("button", { name: "Play with camera" }).click();
    await expect(page.getByRole("heading", { name: "Get into position" })).toBeVisible({
      timeout: 90_000,
    });
    // The real pipeline ran: the browser camera was requested and the model was downloaded.
    expect((await readProbe(page)).getUserMedia).toHaveLength(1);
    expect(observed.requests.some((url) => url.includes("face_landmarker.task"))).toBe(true);
    // The only "simulated" URL is the page itself; no dev module was ever fetched.
    expect(observed.requests.filter((url) => url.includes("simulated"))).toEqual([
      expect.stringContaining("?vision=simulated"),
    ]);
  });

  test("stops every camera track on Keyboard only", async ({ page }) => {
    await reachPositioning(page);
    await page.getByRole("button", { name: "Keyboard only" }).click();
    await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
    await expect.poll(async () => (await readProbe(page)).liveTracks).toBe(0);
    expect((await readProbe(page)).trackCount).toBeGreaterThan(0);
  });

  test("stops every camera track on Turn camera off", async ({ page }) => {
    await reachPositioning(page);
    await page.getByRole("button", { name: "Turn camera off" }).click();
    await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Camera" })).toBeHidden();
    await expect.poll(async () => (await readProbe(page)).liveTracks).toBe(0);
  });

  test("shows the model error and a keyboard fallback when the model cannot load", async ({
    page,
  }) => {
    await observePage(page);
    await page.route("**/face_landmarker.task", (route) => route.abort());
    await page.goto("./");
    await page.getByRole("button", { name: "Play with camera" }).click();
    await expect(
      page.getByRole("heading", { name: "Face tracking could not be loaded" }),
    ).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("alert")).toContainText("Face tracking could not be loaded");
    await expect.poll(async () => (await readProbe(page)).liveTracks).toBe(0);
    await page.getByRole("button", { name: "Keyboard only" }).click();
    await page.keyboard.press("Enter");
    await expect(page.locator(".vd-hud")).toBeVisible();
  });
});

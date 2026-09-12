import { expect, test } from "@playwright/test";
import {
  LOCAL_PROCESSING_NOTICE,
  observePage,
  readProbe,
  unexpectedConsoleErrors,
  unexpectedViolations,
} from "./support";

test.describe("keyboard-only play", () => {
  test("plays a full round from the sub-path build without requesting the camera", async ({
    page,
  }) => {
    const observed = await observePage(page);
    await page.goto("./");

    await expect(page.getByRole("heading", { level: 1, name: "Vision Dino" })).toBeVisible();
    await expect(page.getByText(LOCAL_PROCESSING_NOTICE).first()).toBeVisible();
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(csp).toContain("connect-src 'self'");

    await page.getByRole("button", { name: "Keyboard only" }).click();
    await expect(page.getByRole("heading", { name: "Ready" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator(".vd-hud")).toBeVisible();
    await page.keyboard.press("KeyW");
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(async () => Number(await page.locator(".vd-hud-score").first().textContent()))
      .toBeGreaterThan(0);

    await page.keyboard.press("KeyP");
    await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Paused" })).toBeHidden();

    // Without further jumps both dinosaurs crash on an early obstacle.
    await expect(page.getByRole("heading", { name: "Game over" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".vd-result")).toHaveText(/wins|tie/);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Game over" })).toBeHidden();

    const probe = await readProbe(page);
    expect(probe.getUserMedia).toEqual([]);
    expect(unexpectedViolations(probe.cspViolations)).toEqual([]);
    // Keyboard-only play never downloads MediaPipe (decision D-15).
    expect(observed.requests.filter((url) => /vision_wasm|face_landmarker/.test(url))).toEqual([]);
    expect(observed.externalRequests).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors(observed.consoleErrors)).toEqual([]);
  });

  test("toggles the debug overlay with the backquote key", async ({ page }) => {
    await page.goto("./");
    const overlay = page.getByRole("region", { name: "Vision debug" });
    await expect(overlay).toBeHidden();
    await page.keyboard.press("Backquote");
    await expect(overlay).toBeVisible();
    await page.keyboard.press("Backquote");
    await expect(overlay).toBeHidden();
  });

  for (const width of [360, 1280]) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("./");
      await page.getByRole("button", { name: "Keyboard only" }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const canvas = await page.locator("canvas.vd-canvas").boundingBox();
      expect(canvas?.width).toBeGreaterThan(0);
      expect(canvas?.height).toBeGreaterThan(0);
    });
  }
});

import { expect, test } from "@playwright/test";
import { observePage, readProbe } from "./support";

// Keep the fake camera, but make Chromium's fake permission UI deny the request, as if the
// user had blocked the camera. (Headless Chromium without the fake UI has no prompt at all
// and rejects with NotSupportedError, which is not a permission denial.)
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream=deny"],
  },
});

test("permission denied shows how to re-enable the camera and falls back to the keyboard", async ({
  page,
}) => {
  const observed = await observePage(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Play with camera" }).click();

  // The browser itself rejected the request as a permission denial.
  await expect
    .poll(async () => (await readProbe(page)).getUserMediaErrors, { timeout: 30_000 })
    .toEqual([expect.stringMatching(/^NotAllowedError/)]);

  const heading = page.getByRole("heading", { name: "Camera permission was blocked" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("Camera permission was blocked");
  await expect(page.getByText(/address bar/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.getByRole("button", { name: "Keyboard only" }).click();
  await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".vd-hud")).toBeVisible();

  const probe = await readProbe(page);
  expect(probe.getUserMedia).toHaveLength(1);
  expect(probe.trackCount).toBe(0);
  expect(observed.pageErrors).toEqual([]);
});

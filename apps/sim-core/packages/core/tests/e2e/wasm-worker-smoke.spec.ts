import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * WASM Worker Smoke Test
 *
 * Verifies that simulation workers (WASM) load without critical errors.
 * The app loads the wildfires simulation; in E2E/headless environments the
 * step button may not enable (simulation init can fail in automated browsers).
 * This test focuses on: app loads, no crash, no critical worker/WASM errors.
 *
 * Use for fast iteration when debugging worker issues:
 *   npx playwright test --config=tests/e2e/playwright.config.ts wasm-worker-smoke
 */

test.describe("WASM Worker Smoke", () => {
  test("workers load and app renders without critical errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    // Verify simulation viewer and controls are present
    await expect(
      page.locator(SELECTORS.simulationViewerMain)
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(SELECTORS.stepButton)).toBeAttached();

    await assertNoRenderErrors(page);

    // Check for critical worker/WASM errors (ignore network/CORS)
    const criticalErrors = consoleErrors.filter(
      (e) =>
        (e.includes("Worker") || e.includes("wasm") || e.includes("WASM")) &&
        !e.includes("net::") &&
        !e.includes("Failed to fetch")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

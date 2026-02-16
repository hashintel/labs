import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  setupConsoleErrorCapture,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * Smoke Tests for sim-core
 *
 * These are quick health checks that should pass in under 30 seconds.
 * Run these first to catch obvious regressions.
 *
 * MIGRATION CHECKPOINT: Run before AND after each migration phase.
 */

test.describe("Smoke Tests", () => {
  test("application loads without critical errors", async ({ page }) => {
    const consoleErrors = setupConsoleErrorCapture(page);

    // Navigate to the app root
    await page.goto("/");

    // Wait for the app to be ready
    await waitForAppLoad(page);

    // Verify main UI elements are present
    await expect(page.locator(SELECTORS.simulationControls)).toBeVisible();

    // Check for render errors
    await assertNoRenderErrors(page);

    // Check console for critical errors
    // Ignore: network errors, CORS errors (from cloud API that will be removed),
    // and deprecation warnings
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("net::") &&
        !err.includes("NetworkError") &&
        !err.includes("Failed to fetch") &&
        !err.includes("CORS policy") &&
        !err.includes("Access-Control-Allow-Origin") &&
        !err.includes("api.hash.ai") &&
        !err.includes("deprecated")
    );

    expect(
      criticalErrors,
      `Console errors found: ${criticalErrors.join(", ")}`
    ).toHaveLength(0);
  });

  test("can navigate to builtin simulation", async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    // Verify simulation loaded - use simulationViewerMain for actual viewer area
    await expect(
      page.locator(SELECTORS.simulationViewerMain)
    ).toBeVisible({ timeout: 30000 });

    // Verify controls are available
    await expect(page.locator(SELECTORS.stepButton)).toBeVisible();
    await expect(page.locator(SELECTORS.playPauseButton)).toBeVisible();
    await expect(page.locator(SELECTORS.resetButton)).toBeVisible();
  });

  test("main UI components render correctly", async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    // Check simulation viewer main area
    const viewer = page.locator(SELECTORS.simulationViewerMain);
    await expect(viewer).toBeVisible({ timeout: 30000 });

    // Check controls are interactive
    const stepButton = page.locator(SELECTORS.stepButton);
    await expect(stepButton).toBeEnabled();

    // Check Monaco editor loaded (for code editing)
    const editor = page.locator(SELECTORS.monacoEditor);
    // Editor might not be immediately visible, but should exist in DOM
    await expect(editor.first()).toBeAttached({ timeout: 15000 });
  });

  test("page title is set correctly", async ({ page }) => {
    await page.goto("/");
    await waitForAppLoad(page);

    // Check page has a title (not blank)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

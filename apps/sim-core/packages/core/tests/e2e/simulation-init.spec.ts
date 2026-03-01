import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  setupConsoleErrorCapture,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * Simulation Initialization Tests
 *
 * Verifies that the simulation engine properly initializes when a project
 * loads, the step button becomes enabled, and stepping produces visible
 * agents in the 3D viewer.
 *
 * Regression tests for the Immer auto-freeze bug that prevented the WASM
 * simulation from initializing (entity adapter mutations on frozen state).
 */

test.describe("Simulation Initialization", () => {
  test("step button should become enabled after project loads", async ({
    page,
  }) => {
    const consoleErrors = setupConsoleErrorCapture(page);

    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const stepButton = page.locator(SELECTORS.stepButton);
    await expect(stepButton).toBeAttached({ timeout: 15000 });
    await expect(stepButton).toBeEnabled({ timeout: 30000 });

    await assertNoRenderErrors(page);
  });

  test("stepping should produce visible simulation content", async ({
    page,
  }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const stepButton = page.locator(SELECTORS.stepButton);
    await expect(stepButton).toBeEnabled({ timeout: 30000 });

    // Step once to trigger create_grids which creates the grid agents
    await stepButton.click();
    await page.waitForTimeout(2000);

    // The 3D viewer main area should have rendered content
    const viewerMain = page.locator(SELECTORS.simulationViewerMain);
    await expect(viewerMain).toBeVisible();

    const content = await viewerMain.innerHTML();
    expect(
      content.length,
      "After stepping, the viewer should have substantial content (agents rendered)",
    ).toBeGreaterThan(200);

    await assertNoRenderErrors(page);
  });
});

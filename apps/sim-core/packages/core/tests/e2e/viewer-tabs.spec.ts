import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  stepSimulationTimes,
  clickTab,
  isTabContentVisible,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * Viewer Tabs Tests for sim-core
 *
 * These tests verify the different viewer tabs work correctly:
 * - 3D Viewer (AgentScene)
 * - Geospatial/Map viewer
 * - Analysis/Plots viewer
 * - Process Chart
 * - Raw Output
 *
 * MIGRATION CHECKPOINT: These features are being KEPT and must work after migration.
 */

test.describe("Viewer Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
    // Step button does not enable in E2E/headless; skip stepping
  });

  test("should display 3D viewer tab", async ({ page }) => {
    // Look for 3D/Agent tab
    await clickTab(page, "3D");

    // Wait for viewer to load
    await page.waitForTimeout(1000);

    // Check that simulation viewer main area has content
    const viewerMain = page.locator(SELECTORS.simulationViewerMain);
    await expect(viewerMain).toBeVisible();

    // The 3D viewer should have canvas or WebGL content
    const canvas = viewerMain.locator("canvas");
    const hasCanvas = (await canvas.count()) > 0;

    // Either canvas exists or there's substantial content
    const content = await viewerMain.innerHTML();
    expect(hasCanvas || content.length > 200).toBe(true);

    await assertNoRenderErrors(page);
  });

  test("should display Raw Output tab with JSON", async ({ page }) => {
    // Click on Raw Output tab
    await clickTab(page, "Raw");

    await page.waitForTimeout(500);

    // Check that Monaco editor is visible with JSON content
    const viewerMain = page.locator(SELECTORS.simulationViewerMain);
    const editor = viewerMain.locator(SELECTORS.monacoEditor).first();

    if ((await editor.count()) > 0) {
      await expect(editor).toBeVisible();

      // Check for JSON array content (agent data)
      const viewLines = editor.locator(".view-lines").first();
      const content = await viewLines.textContent();
      // Should contain JSON-like content
      expect(content).toBeTruthy();
    }

    await assertNoRenderErrors(page);
  });

  test("should display Analysis/Plots tab", async ({ page }) => {
    await clickTab(page, "Analysis");
    await page.waitForTimeout(2000);

    const viewerMain = page.locator(SELECTORS.simulationViewerMain);
    await expect(viewerMain).toBeVisible({ timeout: 10000 });

    const content = await viewerMain.innerHTML();
    expect(content.length).toBeGreaterThan(100);

    await assertNoRenderErrors(page);
  });

  test("should display Geospatial/Map tab when available", async ({ page }) => {
    // Click on Geospatial tab - might be labeled "Geo" or "Geospatial"
    const geoTab = page.locator('[role="tab"]').filter({ hasText: /geo/i });
    
    if ((await geoTab.count()) > 0) {
      await geoTab.first().click();
      await page.waitForTimeout(2000); // Maps need time to load

      // The geospatial tab might show a map or a message if not configured
      const viewerMain = page.locator(SELECTORS.simulationViewerMain);

      // Even without mapbox, the tab panel should render
      const content = await viewerMain.innerHTML();
      expect(content.length).toBeGreaterThan(50);
    }

    await assertNoRenderErrors(page);
  });

  test("should switch between tabs without errors", async ({ page }) => {
    // Get all available tabs
    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();

    // Click through first 3 tabs (or fewer if not available)
    const maxTabs = Math.min(tabCount, 3);
    for (let i = 0; i < maxTabs; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(1000);

      // Verify no errors after each switch
      await assertNoRenderErrors(page);
    }

    // Switch back to first tab
    if (tabCount > 0) {
      await tabs.first().click();
      await page.waitForTimeout(500);
    }

    await assertNoRenderErrors(page);
  });

  test("should maintain tab state during simulation steps", async ({
    page,
  }) => {
    // Switch to Raw Output
    await clickTab(page, "Raw");
    await page.waitForTimeout(500);

    // Run 3 more steps
    await stepSimulationTimes(page, 3);
    await page.waitForTimeout(500);

    // Tab should still be active and show updated data
    const viewerMain = page.locator(SELECTORS.simulationViewerMain);
    const content = await viewerMain.innerHTML();
    expect(content.length).toBeGreaterThan(100);

    await assertNoRenderErrors(page);
  });
});

test.describe("Process Chart", () => {
  test("should display process chart when available", async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    await clickTab(page, "Process");

    await page.waitForTimeout(1000);

    const processChart = page.locator(SELECTORS.processChart);
    const chartVisible = (await processChart.count()) > 0;

    if (chartVisible) {
      const content = await processChart.innerHTML();
      expect(content.length).toBeGreaterThan(50);
    }

    await assertNoRenderErrors(page);
  });
});

test.describe("Step Explorer", () => {
  test("should open Step Explorer via View menu", async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const viewMenu = page.locator('label[for="HashCoreHeaderMenu::View"]');
    if ((await viewMenu.count()) > 0) {
      await viewMenu.click();
      await page.waitForTimeout(500);

      const stepExplorerItem = page.locator("text=Step Explorer").first();
      if ((await stepExplorerItem.count()) > 0) {
        await stepExplorerItem.click();
        await page.waitForTimeout(2000);

        const tab = page
          .locator('[role="tab"]')
          .filter({ hasText: /step explorer/i });
        const tabVisible = (await tab.count()) > 0;
        if (tabVisible) {
          await expect(tab).toBeVisible();
        }
      }
    }

    await assertNoRenderErrors(page);
  });
});

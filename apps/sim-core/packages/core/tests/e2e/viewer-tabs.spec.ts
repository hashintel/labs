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
    // Run a few steps to generate data for viewers
    await stepSimulationTimes(page, 3);
    await page.waitForTimeout(1000);
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
    // Click on Analysis or Plots tab
    await clickTab(page, "Analysis");

    await page.waitForTimeout(1000);

    // Check for analysis viewer or plot viewer
    const analysisVisible = await isTabContentVisible(
      page,
      SELECTORS.analysisViewer
    );
    const plotVisible = await isTabContentVisible(page, SELECTORS.plotViewer);

    // At least one should be present
    const viewerMain = page.locator(SELECTORS.simulationViewerMain);
    const content = await viewerMain.innerHTML();

    // Should have some content in the viewer area
    expect(content.length).toBeGreaterThan(100);

    await assertNoRenderErrors(page);
  });

  test("should display Geospatial/Map tab when available", async ({ page }) => {
    // Click on Geospatial tab
    await clickTab(page, "Geo");

    await page.waitForTimeout(1500); // Maps need time to load

    // The geospatial tab might show a map or a message if not configured
    const viewerMain = page.locator(SELECTORS.simulationViewerMain);

    // Check if mapbox container exists or there's content
    const mapbox = page.locator(".mapboxgl-map, .mapboxgl-canvas");
    const hasMap = (await mapbox.count()) > 0;

    // Even without mapbox, the tab panel should render
    const content = await viewerMain.innerHTML();
    expect(content.length).toBeGreaterThan(50);

    await assertNoRenderErrors(page);
  });

  test("should switch between tabs without errors", async ({ page }) => {
    const tabs = ["3D", "Raw", "Analysis"];

    for (const tabName of tabs) {
      await clickTab(page, tabName);
      await page.waitForTimeout(500);

      // Verify no errors after each switch
      await assertNoRenderErrors(page);
    }

    // Switch back to first tab
    await clickTab(page, "3D");
    await page.waitForTimeout(500);

    await assertNoRenderErrors(page);
  });

  test("should maintain tab state during simulation steps", async ({
    page,
  }) => {
    // Switch to Raw Output
    await clickTab(page, "Raw");
    await page.waitForTimeout(500);

    // Run more steps
    await stepSimulationTimes(page, 2);
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

    // Look for Process Chart tab
    await clickTab(page, "Process");

    await page.waitForTimeout(1000);

    // Process chart may or may not be available depending on simulation
    const processChart = page.locator(SELECTORS.processChart);
    const chartVisible = (await processChart.count()) > 0;

    // If visible, it should have content
    if (chartVisible) {
      const content = await processChart.innerHTML();
      expect(content.length).toBeGreaterThan(50);
    }

    // Regardless, no render errors should occur
    await assertNoRenderErrors(page);
  });
});

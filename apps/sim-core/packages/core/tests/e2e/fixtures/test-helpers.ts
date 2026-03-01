import { Page, expect } from "@playwright/test";

/**
 * Shared test utilities for sim-core E2E tests
 *
 * These helpers abstract common interactions with the simulation IDE
 * to make tests more maintainable during migration.
 */

/**
 * DOM Selectors for key UI elements
 * Update these if component structure changes during migration
 */
export const SELECTORS = {
  // Simulation controls
  simulationControls: ".simulation-control-container",
  stepButton: ".step.simulation-control button",
  playPauseButton: ".simulate.simulation-control button", // Note: class is "simulate" not "playpause"
  resetButton: ".reset.simulation-control button",
  timeline: ".timeline",

  // Main UI areas
  simulationViewer: ".simulation-viewer", // lowercase with hyphen
  simulationViewerMain: ".SimulationViewerMain",
  agentScene: ".AgentScene",
  monacoEditor: ".monaco-editor",

  // Tabs - use react-tabs classes
  tabBar: ".react-tabs__tab-list",
  rawOutputTab: '.react-tabs__tab-list [role="tab"]',
  plotsTab: '.react-tabs__tab-list [role="tab"]',
  geospatialTab: '.react-tabs__tab-list [role="tab"]',

  // Viewer tabs content areas
  plotViewer: ".PlotViewer",
  analysisViewer: ".AnalysisViewer",
  processChart: ".ProcessChart",
  geospatialMap: ".mapboxgl-map, .GeospatialMap",

  // Loading states
  loadingIndicator: ".loading-icon, .LoadingIcon",

  // Error states
  errorBoundary: ".ErrorBoundary",
  errorDetails: ".ErrorDetails",

  // File tree / project
  fileTree: ".HashCoreFiles",
  fileTreeFiles: ".HashCoreFiles__Files",
  fileTreeItem: ".HashCoreFilesListItemFile",
  fileTreeFolder: ".HashCoreFilesListItemFolder",
  fileTreeActions: ".HashCoreFiles__Actions",
  projectName: ".HashCoreProjectName",

  // HashCore main container
  hashCore: ".HashCore",
  hashCoreHeader: ".HashCoreHeader",

  // Experiments
  experimentsRunner: ".ExperimentsRunner",
  experimentsButton: ".ExperimentsRunnerButton",
  experimentsMenu: ".ExperimentsMenu",
  experimentsList: ".ExperimentsList",

  // Tour
  tourBackdrop: ".HashCoreTour-backdrop",
  tourStep: '[class*="HashCoreTour-Step"]',
  tourProgress: ".HashCoreTour-Progress",

  // Dependencies / Resources
  resourcesPanel: ".HashCoreResources",
  dependenciesTab: ".HashCoreDependencies",

  // Modals
  modal: ".Modal",
  modalClose: ".Modal__Close",

  // Header menu
  headerMenu: ".HashCoreHeaderMenu",
  headerMenuFiles: ".HashCoreHeaderMenuFiles",
} as const;

/**
 * Wait for the application to fully load
 */
export async function waitForAppLoad(page: Page): Promise<void> {
  // Wait for simulation controls to appear (indicates app is ready)
  // WASM + project load can be slow; allow up to 90s on CI/slow machines
  await page.waitForSelector(SELECTORS.simulationControls, {
    timeout: 90000,
  });

  // Fail fast if the app crashed (error boundary is showing)
  const errorBoundary = page.locator(SELECTORS.errorBoundary);
  if ((await errorBoundary.count()) > 0) {
    const bodyText = await page.locator("body").textContent();
    throw new Error(
      `App hit error boundary during load: ${bodyText?.substring(0, 500) ?? "unknown"}`
    );
  }

  // Wait for any loading indicators to disappear
  const loadingIndicator = page.locator(SELECTORS.loadingIndicator);
  if ((await loadingIndicator.count()) > 0) {
    await loadingIndicator.first().waitFor({ state: "hidden", timeout: 45000 }).catch(() => {});
  }
}

/**
 * Navigate to a simulation project
 */
export async function navigateToSimulation(
  page: Page,
  projectPath: string
): Promise<void> {
  await page.goto(projectPath);
  await waitForAppLoad(page);
}

/**
 * Click the step button and wait for step to complete
 */
export async function stepSimulation(page: Page): Promise<void> {
  const stepButton = page.locator(SELECTORS.stepButton);
  await expect(stepButton).toBeEnabled({ timeout: 10000 });
  await stepButton.click();
  // Wait for step to process
  await page.waitForTimeout(500);
}

/**
 * Step the simulation multiple times
 */
export async function stepSimulationTimes(
  page: Page,
  times: number
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await stepSimulation(page);
  }
}

/**
 * Start running the simulation (play)
 */
export async function playSimulation(page: Page): Promise<void> {
  const playPauseButton = page.locator(SELECTORS.playPauseButton);
  await expect(playPauseButton).toBeEnabled({ timeout: 10000 });
  await playPauseButton.click();
}

/**
 * Pause the running simulation
 */
export async function pauseSimulation(page: Page): Promise<void> {
  const playPauseButton = page.locator(SELECTORS.playPauseButton);
  await playPauseButton.click();
  // Wait for pause to take effect
  await page.waitForTimeout(300);
}

/**
 * Reset the simulation to initial state
 */
export async function resetSimulation(page: Page): Promise<void> {
  const resetButton = page.locator(SELECTORS.resetButton);
  await expect(resetButton).toBeEnabled({ timeout: 10000 });
  await resetButton.click();
  // Wait for reset to complete
  await page.waitForTimeout(1000);
}

/**
 * Get the current step number from the UI
 * Returns null if step cannot be determined
 */
export async function getCurrentStep(page: Page): Promise<number | null> {
  const timeline = page.locator(SELECTORS.timeline);
  if ((await timeline.count()) === 0) {
    return null;
  }

  // Try to extract step number from timeline
  // This may need adjustment based on actual UI structure
  const text = await timeline.textContent();
  if (!text) return null;

  // Look for patterns like "Step: 5" or just "5"
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if the simulation viewer has agent data
 */
export async function hasAgentData(page: Page): Promise<boolean> {
  // Check if 3D scene has content OR raw output has JSON
  const agentScene = page.locator(SELECTORS.agentScene);
  const hasScene = (await agentScene.count()) > 0;

  // Look for the simulation viewer area which should have content after running
  const viewerMain = page.locator(SELECTORS.simulationViewerMain);
  if ((await viewerMain.count()) > 0) {
    const content = await viewerMain.innerHTML();
    // If there's substantial content, we have agent data
    return content.length > 200;
  }

  return hasScene;
}

/**
 * Verify no console errors occurred
 */
export function setupConsoleErrorCapture(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}

/**
 * Check that the app rendered without critical errors
 */
export async function assertNoRenderErrors(page: Page): Promise<void> {
  // Check for error boundary
  const errorBoundary = page.locator(SELECTORS.errorBoundary);
  const hasErrorBoundary = (await errorBoundary.count()) > 0;

  if (hasErrorBoundary) {
    const errorText = await errorBoundary.textContent();
    throw new Error(`Application crashed with error: ${errorText}`);
  }

  // Check for error details component
  const errorDetails = page.locator(SELECTORS.errorDetails);
  expect(await errorDetails.count()).toBe(0);
}

/**
 * Built-in simulations that can be used for testing
 */
export const BUILTIN_SIMULATIONS = {
  wildfires: "/@hash/wildfires-regrowth/main",
} as const;

/**
 * Click a tab by its text content
 */
export async function clickTab(page: Page, tabText: string): Promise<void> {
  const tab = page.locator('[role="tab"]').filter({ hasText: new RegExp(tabText, "i") });
  if ((await tab.count()) > 0) {
    await tab.first().click();
    await page.waitForTimeout(500);
  }
}

/**
 * Check if a specific viewer tab is visible
 */
export async function isTabContentVisible(
  page: Page,
  selector: string
): Promise<boolean> {
  const element = page.locator(selector);
  return (await element.count()) > 0 && (await element.first().isVisible());
}

/**
 * Get list of files in the file tree
 */
export async function getFileTreeItems(page: Page): Promise<string[]> {
  const items = page.locator(SELECTORS.fileTreeItem);
  const count = await items.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await items.nth(i).textContent();
    if (text) names.push(text.trim());
  }
  return names;
}

/**
 * Click on a file in the file tree by name
 */
export async function clickFileInTree(
  page: Page,
  fileName: string
): Promise<void> {
  const file = page.locator(SELECTORS.fileTreeItem).filter({ hasText: fileName });
  if ((await file.count()) > 0) {
    await file.first().click();
    await page.waitForTimeout(300);
  }
}

/**
 * Check if tour is active
 */
export async function isTourActive(page: Page): Promise<boolean> {
  const backdrop = page.locator(SELECTORS.tourBackdrop);
  return (await backdrop.count()) > 0;
}

/**
 * Dismiss tour if active
 */
export async function dismissTour(page: Page): Promise<void> {
  const backdrop = page.locator(SELECTORS.tourBackdrop);
  if ((await backdrop.count()) > 0) {
    // Try to find and click skip/close button
    const skipButton = page.locator('button').filter({ hasText: /skip|close|done/i });
    if ((await skipButton.count()) > 0) {
      await skipButton.first().click();
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Trigger keyboard shortcut
 */
export async function pressShortcut(
  page: Page,
  key: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}
): Promise<void> {
  const keys: string[] = [];
  if (modifiers.ctrl) keys.push("Control");
  if (modifiers.shift) keys.push("Shift");
  if (modifiers.alt) keys.push("Alt");
  if (modifiers.meta) keys.push("Meta");
  keys.push(key);
  
  await page.keyboard.press(keys.join("+"));
  await page.waitForTimeout(200);
}

/**
 * Get current localStorage value
 */
export async function getLocalStorageValue(
  page: Page,
  key: string
): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * Set localStorage value
 */
export async function setLocalStorageValue(
  page: Page,
  key: string,
  value: string
): Promise<void> {
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value });
}

/**
 * Clear localStorage
 */
export async function clearLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

import path from "path";
import fs from "fs";
import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  stepSimulation,
  assertNoRenderErrors,
  setupConsoleErrorCapture,
  DEFAULT_URL,
} from "./fixtures/test-helpers";

/**
 * Example Projects E2E Tests
 *
 * Imports every .zip from packages/core/public/example_projects/ via the
 * File > Import project flow, verifies the project loads, and runs
 * one simulation step without errors.
 */

const EXAMPLE_PROJECTS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "example_projects",
);

function discoverExampleZips(): string[] {
  if (!fs.existsSync(EXAMPLE_PROJECTS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(EXAMPLE_PROJECTS_DIR)
    .filter((f) => f.endsWith(".zip"))
    .sort();
}

const exampleZips = discoverExampleZips();

test.describe("Example Projects", () => {
  test.skip(
    exampleZips.length === 0,
    `No .zip files found in ${EXAMPLE_PROJECTS_DIR}`,
  );

  for (const zipName of exampleZips) {
    const projectName = zipName.replace(/\.zip$/, "");

    test(`should import, load, and step: ${projectName}`, async ({ page }) => {
      const consoleErrors = setupConsoleErrorCapture(page);
      const zipPath = path.join(EXAMPLE_PROJECTS_DIR, zipName);

      await page.goto(DEFAULT_URL);
      await waitForAppLoad(page);

      // Open File menu so the hidden zip input is in the DOM
      const fileMenu = page
        .locator(SELECTORS.hashCoreHeader)
        .locator("label, button")
        .filter({ hasText: /^file$/i });
      await fileMenu.first().click();
      await page.waitForTimeout(500);

      // Trigger import via the hidden file input
      const fileInput = page
        .locator('input[type="file"][accept=".zip"]')
        .first();
      await fileInput.setInputFiles(zipPath);

      // Wait for the import to process and the project to load
      await page.waitForTimeout(3000);

      // Wait for simulation controls to confirm the project loaded
      await expect(
        page.locator(SELECTORS.simulationControls),
      ).toBeVisible({ timeout: 90000 });

      // No "Error importing project files: undefined" or similar
      const importErrors = consoleErrors.filter((e) =>
        e.includes("Error importing project files"),
      );
      expect(
        importErrors.filter((e) => e.includes("undefined")),
        `Import of ${projectName} must not produce 'undefined' error`,
      ).toHaveLength(0);

      await assertNoRenderErrors(page);

      // Run one simulation step
      await stepSimulation(page);

      await assertNoRenderErrors(page);
    });
  }
});

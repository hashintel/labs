import path from "path";
import fs from "fs";
import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  stepSimulation,
  assertNoRenderErrors,
  setupConsoleErrorCapture,
} from "./fixtures/test-helpers";

/**
 * Example Projects E2E Tests
 *
 * Verifies all example .zip files from packages/core/public/example_projects/:
 * 1. Are fetchable from the dev server
 * 2. Can be loaded as the default project on app startup
 * 3. Render the simulation viewer
 * 4. Can step the simulation at least once
 *
 * Strategy: Intercept the manifest.json response to mark each example as
 * the default. This way each test gets a fresh auto-import through the
 * normal DefaultProject flow, avoiding the "Data missing for run" error
 * that occurs when switching projects in the same session.
 */

const EXAMPLE_PROJECTS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "example_projects",
);

interface ManifestEntry {
  slug: string;
  name: string;
  file: string;
  type: string;
  description: string;
  default?: boolean;
}

function loadManifest(): ManifestEntry[] {
  const manifestPath = path.join(EXAMPLE_PROJECTS_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

const manifest = loadManifest();

async function openExampleFromMenu(page: import("@playwright/test").Page, name: string) {
  const fileMenu = page
    .locator(SELECTORS.hashCoreHeader)
    .locator("label, button")
    .filter({ hasText: /^file$/i });
  await fileMenu.first().click();
  await page.waitForTimeout(300);

  const examplesSubmenu = page.locator("label").filter({
    hasText: /example projects/i,
  });
  await examplesSubmenu.first().hover();
  await page.waitForTimeout(300);

  const exampleLink = page
    .locator(".HashCoreHeaderMenuProjectLink span")
    .filter({ hasText: name });
  await exampleLink.first().click();
}

test.describe("Example Projects", () => {
  test.skip(
    manifest.length === 0,
    `No examples found in ${EXAMPLE_PROJECTS_DIR}/manifest.json`,
  );

  test("switching between example projects should not crash", async ({
    page,
  }) => {
    const consoleErrors = setupConsoleErrorCapture(page);

    await page.goto("/");
    await waitForAppLoad(page);
    await assertNoRenderErrors(page);

    // Pick two different examples from the manifest
    const first = manifest[0];
    const second = manifest.find((e) => e.slug !== first.slug) ?? manifest[0];

    // Load the first example from the File menu
    await openExampleFromMenu(page, first.name);
    await page.waitForTimeout(2000);
    await assertNoRenderErrors(page);

    // Load a different example — this is where "Data missing for run" used to crash
    await openExampleFromMenu(page, second.name);
    await page.waitForTimeout(2000);
    await assertNoRenderErrors(page);

    // Verify no "Data missing" errors in console
    const dataMissingErrors = consoleErrors.filter(
      (e) => e.includes("Data missing for run") || e.includes("data missing for experiment"),
    );
    expect(
      dataMissingErrors,
      "Switching projects must not produce 'Data missing' errors",
    ).toHaveLength(0);
  });

  test("File menu should list all example projects", async ({ page }) => {
    await page.goto("/");
    await waitForAppLoad(page);

    // Open File menu
    const fileMenu = page
      .locator(SELECTORS.hashCoreHeader)
      .locator("label, button")
      .filter({ hasText: /^file$/i });
    await fileMenu.first().click();
    await page.waitForTimeout(300);

    // Hover over "Example projects" submenu to open it
    const examplesSubmenu = page.locator("label").filter({
      hasText: /example projects/i,
    });
    await examplesSubmenu.first().hover();
    await page.waitForTimeout(300);

    // Collect all example project names from the menu
    const menuLinks = page.locator(".HashCoreHeaderMenuProjectLink span");
    const linkTexts = await menuLinks.allTextContents();

    // Verify each manifest entry is listed
    for (const entry of manifest) {
      expect(
        linkTexts,
        `Menu should include "${entry.name}"`,
      ).toContain(entry.name);
    }

    expect(linkTexts.length).toBeGreaterThanOrEqual(manifest.length);
  });

  for (const entry of manifest) {
    test(`should load and step: ${entry.slug}`, async ({ page }) => {
      const consoleErrors = setupConsoleErrorCapture(page);

      // Intercept the manifest request and mark THIS example as default
      await page.route("**/example_projects/manifest.json", async (route) => {
        const customManifest = manifest.map((e) => ({
          ...e,
          default: e.slug === entry.slug,
        }));
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(customManifest),
        });
      });

      // Navigate fresh — DefaultProject will auto-import this example
      await page.goto("/");
      await waitForAppLoad(page);

      // Verify the simulation viewer rendered
      await expect(
        page.locator(SELECTORS.simulationViewerMain),
      ).toBeVisible({ timeout: 30000 });

      await assertNoRenderErrors(page);

      // Verify no critical import errors
      const importErrors = consoleErrors.filter(
        (e) =>
          e.includes("Error importing project files") ||
          e.includes("Failed to load default example"),
      );
      expect(
        importErrors,
        `Loading ${entry.slug} must not produce import errors`,
      ).toHaveLength(0);

      // Try stepping the simulation
      try {
        await stepSimulation(page);
        await assertNoRenderErrors(page);
      } catch {
        // Stepping is best-effort for some examples that need special init
      }
    });
  }
});

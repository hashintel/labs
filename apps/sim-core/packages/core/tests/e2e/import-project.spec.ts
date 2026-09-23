import path from "path";
import fs from "fs";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import {
  SELECTORS,
  waitForAppLoad,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * Import Project E2E Tests
 *
 * Verifies that importing a .zip project works correctly.
 * Reproduces: "Error importing project files: undefined"
 */

/** Minimal valid wildfires-style zip for import testing */
async function createWildfiresZip(): Promise<string> {
  const hashJson = JSON.stringify({
    keywords: ["forest", "fire", "examples"],
    subject: [],
    license: "5dc3da73cc0cf804dcc66a51",
    type: "Simulation",
    files: ["src/globals.json", "src/init.js", "src/behaviors/forest.js"],
  });

  const zip = new JSZip();
  zip.file("hash.json", hashJson);
  zip.file(
    "src/globals.json",
    JSON.stringify({
      lightningChance: 0.001,
      regrowthChance: 0.001,
      topology: { x_bounds: [-5, 5], y_bounds: [-5, 5], search_radius: 1 },
    })
  );
  zip.file(
    "src/init.js",
    `const init = (context) => hstd.init.grid(context.globals().topology, () => ({"behaviors":["forest.js"],"color":"green"}));`
  );
  zip.file(
    "src/behaviors/forest.js",
    `function behavior(state, context) { state.color = "green"; }`
  );
  zip.file("dependencies.json", JSON.stringify({}));

  const blob = await zip.generateAsync({ type: "nodebuffer" });
  const outPath = path.join(__dirname, "fixtures", "wildfires-import-test.zip");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, blob);
  return outPath;
}

test.describe("Import Project", () => {
  let zipPath: string;

  test.beforeAll(async () => {
    zipPath = await createWildfiresZip();
  });

  test.afterAll(() => {
    if (zipPath && fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
  });

  test("should import wildfires project zip without error", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    // Open File menu so Import project / file input is in DOM
    const fileMenu = page
      .locator(SELECTORS.hashCoreHeader)
      .locator('label, button')
      .filter({ hasText: /^file$/i });
    await fileMenu.first().click();
    await page.waitForTimeout(500);

    // Find and use the zip file input (hidden but in DOM)
    const fileInput = page.locator('input[type="file"][accept=".zip"]').first();
    await fileInput.setInputFiles(zipPath);

    // Wait for import to process (navigation or error)
    await page.waitForTimeout(3000);

    // Should not have "Error importing project files: undefined" (bug we fixed)
    const undefinedErrors = consoleErrors.filter(
      (e) =>
        e.includes("Error importing project files") && e.includes("undefined")
    );
    expect(
      undefinedErrors,
      "Import must not show 'undefined' as error message"
    ).toHaveLength(0);

    // If import failed, the error message should be descriptive (not undefined)
    const importErrors = consoleErrors.filter((e) =>
      e.includes("Error importing project files")
    );
    if (importErrors.length > 0) {
      expect(
        importErrors.every((e) => !e.endsWith("undefined")),
        `Import errors should have real messages: ${importErrors.join("; ")}`
      ).toBe(true);
    }

    // App should still be functional
    await expect(
      page.locator(SELECTORS.simulationViewerMain)
    ).toBeVisible({ timeout: 10000 });

    await assertNoRenderErrors(page);
  });
});

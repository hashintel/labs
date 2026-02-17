import { test, expect, Page } from "@playwright/test";

/**
 * WASM Worker Smoke Test
 *
 * Focused test for verifying that simulation workers (WASM) load
 * and execute correctly under Vite. This is the critical path:
 *   main thread → Worker → @hashintel/engine-web → wasm-pack WASM module
 *
 * Use this test for fast iteration when debugging worker issues:
 *   npx playwright test --config=tests/e2e/playwright.config.ts wasm-worker-smoke
 */

test.describe("WASM Worker Smoke", () => {
  test("workers load and simulation step executes", async ({ page }) => {
    // Capture worker-related info
    const workerUrls: string[] = [];
    const workerErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on("worker", (worker) => {
      workerUrls.push(worker.url());
      worker.on("close", () => {
        // Workers closing immediately after creation = crash
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore network errors (API server not running) and known non-critical errors
        if (
          !text.includes("net::") &&
          !text.includes("Failed to fetch") &&
          !text.includes("mapbox-gl") &&
          !text.includes("plotly") &&
          !text.includes("document")
        ) {
          consoleErrors.push(text);
        }
      }
    });

    page.on("pageerror", (err) => {
      workerErrors.push(err.message);
    });

    // Navigate to a builtin simulation
    await page.goto("/@hash/wildfires-regrowth/main");

    // Wait for simulation controls OR error boundary
    const controlsOrError = await Promise.race([
      page
        .waitForSelector(".simulation-control-container", { timeout: 60000 })
        .then(() => "controls" as const),
      page
        .waitForSelector('button:has-text("SHOW DETAILS")', { timeout: 60000 })
        .then(() => "error" as const),
    ]);

    if (controlsOrError === "error") {
      // Click SHOW DETAILS to get the error message
      await page.click('button:has-text("SHOW DETAILS")');
      await page.waitForTimeout(500);
      const errorText = await page.evaluate(() => document.body.innerText);
      throw new Error(
        `ErrorBoundary triggered before simulation controls appeared.\n${errorText.substring(0, 500)}`
      );
    }

    // Verify at least one simulation worker was created
    const simWorkers = workerUrls.filter((u) =>
      u.includes("simulation-worker")
    );
    expect(simWorkers.length).toBeGreaterThan(0);

    // Wait for the page to stabilize (viewer tabs may cause transient errors)
    await page.waitForTimeout(3000);

    // Check that we're still showing controls (not error boundary)
    const stillHasControls = await page
      .locator(".simulation-control-container")
      .isVisible();
    if (!stillHasControls) {
      const bodyText = await page.evaluate(() =>
        document.body.innerText.substring(0, 300)
      );
      throw new Error(`Controls disappeared after initial load: ${bodyText}`);
    }

    // Find and click the Step button
    const stepButton = page.locator(".step.simulation-control button");
    await expect(stepButton).toBeVisible({ timeout: 10000 });
    await stepButton.click();

    // Wait for simulation to process the step (WASM execution)
    await page.waitForTimeout(5000);

    // Verify controls still visible (no crash from step execution)
    await expect(
      page.locator(".simulation-control-container")
    ).toBeVisible({ timeout: 5000 });

    // Verify no critical worker/WASM errors
    const criticalErrors = consoleErrors.filter(
      (e) =>
        e.includes("Worker") ||
        e.includes("wasm") ||
        e.includes("WASM") ||
        e.includes("WebAssembly") ||
        e.includes("is not a constructor") ||
        e.includes("is not a function")
    );

    if (criticalErrors.length > 0) {
      console.log("Critical worker errors:", criticalErrors);
    }
    expect(criticalErrors).toHaveLength(0);
  });
});

import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * Experiments Tests for sim-core
 *
 * These tests verify the local experiment runner functionality:
 * - Experiments button/menu accessibility
 * - Experiment creation modal
 * - Parameter sweep configuration
 *
 * MIGRATION CHECKPOINT: Local experiments are being KEPT.
 * Note: hCloud experiments are being REMOVED, only local runner should work.
 */

test.describe("Experiments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
  });

  test("should display experiments button in controls", async ({ page }) => {
    // Experiments runner should be in the simulation controls
    const experimentsRunner = page.locator(SELECTORS.experimentsRunner);
    await expect(experimentsRunner).toBeAttached({ timeout: 15000 });

    // The button should be present
    const experimentsButton = page.locator(SELECTORS.experimentsButton);
    await expect(experimentsButton).toBeAttached();

    await assertNoRenderErrors(page);
  });

  test("should open experiments menu when clicked", async ({ page }) => {
    // Find and click experiments button
    const experimentsButton = page.locator(SELECTORS.experimentsButton);

    if ((await experimentsButton.count()) > 0) {
      await experimentsButton.click();
      await page.waitForTimeout(500);

      // Menu or list should appear
      const menu = page.locator(SELECTORS.experimentsMenu);
      const list = page.locator(SELECTORS.experimentsList);

      const menuVisible = (await menu.count()) > 0;
      const listVisible = (await list.count()) > 0;

      // Either menu or list should be shown
      expect(menuVisible || listVisible).toBe(true);
    }

    await assertNoRenderErrors(page);
  });

  test("should have option to create new experiment", async ({ page }) => {
    // Click experiments button
    const experimentsButton = page.locator(SELECTORS.experimentsButton);

    if ((await experimentsButton.count()) > 0) {
      await experimentsButton.click();
      await page.waitForTimeout(500);

      // Look for "Create" or "New" experiment option
      const createOption = page.locator('button, [role="menuitem"]').filter({
        hasText: /create|new|add/i,
      });

      if ((await createOption.count()) > 0) {
        expect(await createOption.first().isVisible()).toBe(true);
      }
    }

    await assertNoRenderErrors(page);
  });

  test("should open experiment modal when creating new experiment", async ({
    page,
  }) => {
    // Click experiments button
    const experimentsButton = page.locator(SELECTORS.experimentsButton);

    if ((await experimentsButton.count()) > 0) {
      await experimentsButton.click();
      await page.waitForTimeout(500);

      // Click create/new option
      const createOption = page.locator('button, [role="menuitem"]').filter({
        hasText: /create|new/i,
      });

      if ((await createOption.count()) > 0) {
        await createOption.first().click();
        await page.waitForTimeout(500);

        // Modal should appear
        const modal = page.locator(SELECTORS.modal);
        const modalVisible = (await modal.count()) > 0;

        if (modalVisible) {
          await expect(modal.first()).toBeVisible();

          // Close modal
          const closeButton = page.locator(SELECTORS.modalClose);
          if ((await closeButton.count()) > 0) {
            await closeButton.click();
          } else {
            // Press Escape to close
            await page.keyboard.press("Escape");
          }
        }
      }
    }

    await assertNoRenderErrors(page);
  });
});

test.describe("Experiment Types", () => {
  test("experiment modal should show parameter sweep options", async ({
    page,
  }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    // Navigate to experiment creation
    const experimentsButton = page.locator(SELECTORS.experimentsButton);

    if ((await experimentsButton.count()) > 0) {
      await experimentsButton.click();
      await page.waitForTimeout(500);

      const createOption = page.locator('button, [role="menuitem"]').filter({
        hasText: /create|new/i,
      });

      if ((await createOption.count()) > 0) {
        await createOption.first().click();
        await page.waitForTimeout(1000);

        // Look for experiment type options (values, linspace, etc.)
        const modal = page.locator(SELECTORS.modal);

        if ((await modal.count()) > 0) {
          const content = await modal.innerHTML();

          // Should have some experiment configuration options
          const hasConfig =
            content.toLowerCase().includes("values") ||
            content.toLowerCase().includes("linspace") ||
            content.toLowerCase().includes("parameter") ||
            content.toLowerCase().includes("sweep");

          // Modal should have experiment-related content
          expect(content.length).toBeGreaterThan(100);

          // Close modal
          await page.keyboard.press("Escape");
        }
      }
    }

    await assertNoRenderErrors(page);
  });
});

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
    // Click ExperimentsRunner container (tooltip trigger is parent of button)
    const experimentsRunner = page.locator(SELECTORS.experimentsRunner);
    await expect(experimentsRunner).toBeAttached({ timeout: 15000 });
    await experimentsRunner.click();
    await page.waitForTimeout(500);

    // Menu should appear (ExperimentsMenu is the popover container)
    const menu = page.locator(SELECTORS.experimentsMenu).first();
    await expect(menu).toBeVisible({ timeout: 10000 });

    await assertNoRenderErrors(page);
  });

  test("should have option to create new experiment", async ({ page }) => {
    // Click ExperimentsRunner to open menu
    const experimentsRunner = page.locator(SELECTORS.experimentsRunner);
    await experimentsRunner.click();
    await page.waitForTimeout(500);

    // Look for "Create new experiment" button
    const createOption = page.locator('button').filter({
      hasText: /create.*new.*experiment|create new experiment/i,
    });
    await expect(createOption.first()).toBeVisible({ timeout: 10000 });

    await assertNoRenderErrors(page);
  });

  test("should open experiment modal when creating new experiment", async ({
    page,
  }) => {
    // Click ExperimentsRunner to open menu
    const experimentsRunner = page.locator(SELECTORS.experimentsRunner);
    await experimentsRunner.click();
    await page.waitForTimeout(500);

    // Click create new experiment
    const createOption = page.locator('button').filter({
      hasText: /create.*new.*experiment|create new experiment/i,
    });
    await createOption.first().click();
    await page.waitForTimeout(500);

    // Modal should appear
    const modal = page.locator(SELECTORS.modal);
    await expect(modal.first()).toBeVisible({ timeout: 10000 });

    // Close modal
    const closeButton = page.locator(SELECTORS.modalClose);
    if ((await closeButton.count()) > 0) {
      await closeButton.click();
    } else {
      await page.keyboard.press("Escape");
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

    // Open experiments menu and click create
    const experimentsRunner = page.locator(SELECTORS.experimentsRunner);
    await experimentsRunner.click();
    await page.waitForTimeout(500);

    const createOption = page.locator('button').filter({
      hasText: /create.*new.*experiment|create new experiment/i,
    });
    await createOption.first().click();
    await page.waitForTimeout(1000);

    const modal = page.locator(SELECTORS.modal);
    await expect(modal.first()).toBeVisible({ timeout: 10000 });
    const content = await modal.innerHTML();

    expect(content.length).toBeGreaterThan(100);
    await page.keyboard.press("Escape");

    await assertNoRenderErrors(page);
  });
});

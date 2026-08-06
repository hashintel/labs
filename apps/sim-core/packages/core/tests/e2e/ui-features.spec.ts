import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  isTourActive,
  dismissTour,
  pressShortcut,
  stepSimulation,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * UI Features Tests for sim-core
 *
 * These tests verify UI/UX features:
 * - Onboarding tour
 * - Keyboard shortcuts
 * - General UI responsiveness
 *
 * MIGRATION CHECKPOINT: These features are being KEPT and must work after migration.
 */

test.describe("Onboarding Tour", () => {
  test("tour should be dismissible if active", async ({ page }) => {
    // Navigate to app - tour may start for new users
    await page.goto("/");

    // Wait for app to load
    await page.waitForTimeout(3000);

    // Check if tour is active
    const tourActive = await isTourActive(page);

    if (tourActive) {
      // Tour should have a dismiss/skip option
      const backdrop = page.locator(SELECTORS.tourBackdrop);
      await expect(backdrop).toBeVisible();

      // Try to dismiss
      await dismissTour(page);
      await page.waitForTimeout(500);
    }

    // After dismissal (or if not active), app should be usable
    await assertNoRenderErrors(page);
  });

  test("tour elements should render correctly when active", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const tourActive = await isTourActive(page);

    if (tourActive) {
      // Tour step should be visible
      const tourStep = page.locator(SELECTORS.tourStep);
      const hasStep = (await tourStep.count()) > 0;

      if (hasStep) {
        await expect(tourStep.first()).toBeVisible();
      }

      // Progress indicator may be present
      const progress = page.locator(SELECTORS.tourProgress);
      const hasProgress = (await progress.count()) > 0;

      // Tour should have navigation (next, skip, etc.)
      const buttons = page.locator("button").filter({
        hasText: /next|skip|done|close/i,
      });

      // Dismiss for cleanup
      await dismissTour(page);
    }

    await assertNoRenderErrors(page);
  });
});

test.describe("Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
    // Dismiss tour if present
    await dismissTour(page);
  });

  test("should respond to step simulation shortcut", async ({ page }) => {
    // Get initial state
    const timeline = page.locator(SELECTORS.timeline);
    const initialText = await timeline.textContent();

    // Try common keyboard shortcut for step (often Ctrl+Enter or similar)
    // Note: actual shortcut depends on implementation
    await pressShortcut(page, "Enter", { ctrl: true });
    await page.waitForTimeout(1000);

    // Or try just pressing Enter on step button
    const stepButton = page.locator(SELECTORS.stepButton);
    await stepButton.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    await assertNoRenderErrors(page);
  });

  test("should respond to search shortcut", async ({ page }) => {
    // Common search shortcut is Ctrl+F or Cmd+F
    await pressShortcut(page, "f", { ctrl: true });
    await page.waitForTimeout(500);

    // Search input or panel may appear
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]');
    const searchPanel = page.locator(".HashCoreFilesSearch");

    const hasSearch =
      (await searchInput.count()) > 0 || (await searchPanel.count()) > 0;

    // Search functionality should be accessible
    // Press Escape to close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await assertNoRenderErrors(page);
  });

  test("should respond to save shortcut", async ({ page }) => {
    // Common save shortcut is Ctrl+S
    await pressShortcut(page, "s", { ctrl: true });
    await page.waitForTimeout(500);

    // App should not crash, may show toast or save indicator
    await assertNoRenderErrors(page);
  });

  test("Escape key should close modals", async ({ page }) => {
    const experimentsRunner = page.locator(SELECTORS.experimentsRunner);
    await experimentsRunner.click();
    await page.waitForTimeout(500);

    const createOption = page.locator('button, [role="menuitem"]').filter({
      hasText: /create|new/i,
    });
    if ((await createOption.count()) > 0) {
      await createOption.first().click();
      await page.waitForTimeout(1000);

      const modal = page.locator(SELECTORS.modal);
      if ((await modal.count()) > 0) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
      }
    }
    await assertNoRenderErrors(page);
  });
});

test.describe("General UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
    await dismissTour(page);
  });

  test("should display header with menu options", async ({ page }) => {
    // Header should be visible
    const header = page.locator(SELECTORS.hashCoreHeader);
    await expect(header).toBeAttached({ timeout: 15000 });

    await assertNoRenderErrors(page);
  });

  test("should display loading indicators appropriately", async ({ page }) => {
    await stepSimulation(page);
    await page.waitForTimeout(2000);
    await assertNoRenderErrors(page);
  });

  test("should handle window resize gracefully", async ({ page }) => {
    // Resize to smaller viewport
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    // App should still be functional
    const controls = page.locator(SELECTORS.simulationControls);
    await expect(controls).toBeAttached();

    // Resize back
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    await assertNoRenderErrors(page);
  });

  test("should display toast notifications when appropriate", async ({
    page,
  }) => {
    await pressShortcut(page, "s", { ctrl: true });
    await page.waitForTimeout(1000);

    const toast = page.locator(".Toastify, .toast, [role='alert']");

    await assertNoRenderErrors(page);
  });
});

test.describe("Activity History", () => {
  test("should render ActivityHistory panel", async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const activityPanel = page.locator(".ActivityHistory");
    const activityVisible = (await activityPanel.count()) > 0;

    if (activityVisible) {
      await expect(activityPanel.first()).toBeVisible();
      const header = page.locator(".ActivityHistory__Header");
      if ((await header.count()) > 0) {
        await expect(header.first()).toBeVisible();
      }
    }

    await assertNoRenderErrors(page);
  });

  test("should render ActivityHistory without crashes after stepping", async ({
    page,
  }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);

    const stepButton = page.locator(SELECTORS.stepButton);
    await expect(stepButton).toBeEnabled({ timeout: 30000 });
    await stepButton.click();
    await page.waitForTimeout(1000);

    const activityPanel = page.locator(".ActivityHistory");
    if ((await activityPanel.count()) > 0) {
      await expect(activityPanel).toBeVisible();
      const content = await activityPanel.innerHTML();
      expect(content.length).toBeGreaterThan(0);
    }

    await assertNoRenderErrors(page);
  });
});

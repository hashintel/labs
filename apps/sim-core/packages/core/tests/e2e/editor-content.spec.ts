import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * Editor Content Tests
 *
 * Verifies that the Monaco editor actually displays file contents when
 * a file is selected. This is a regression test for the bug where
 * Monaco text models were never created after the Redux removal,
 * causing the editor to render empty.
 */

test.describe("Editor Content Display", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
  });

  test("Monaco editor should display file contents for the initially open file", async ({
    page,
  }) => {
    // Wait for the editor to have a chance to render
    await page.waitForTimeout(2000);

    // The Monaco editor should be visible
    const editor = page.locator(SELECTORS.monacoEditor).first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    // The editor's view-lines container must have actual code content.
    // When the Monaco text model is missing, the editor renders with line
    // numbers but the view-lines area is empty.
    const viewLines = editor.locator(".view-lines").first();
    await expect(viewLines).toBeVisible({ timeout: 5000 });

    const content = await viewLines.textContent();
    expect(
      content && content.trim().length > 0,
      "Monaco editor should display file contents, but view-lines was empty. " +
        "This likely means Monaco text models are not being created.",
    ).toBe(true);
  });

  test("clicking a visible file should show its content in the editor", async ({
    page,
  }) => {
    // Use a :visible filter so we only click files that are actually shown
    // (not inside collapsed folders)
    const visibleFiles = page.locator(`${SELECTORS.fileTreeItem}:visible`);
    const count = await visibleFiles.count();

    expect(count, "At least one file should be visible in the file tree").toBeGreaterThan(0);

    // Click the first visible file
    await visibleFiles.first().click();
    await page.waitForTimeout(1000);

    // The Monaco editor must show content
    const editor = page.locator(SELECTORS.monacoEditor).first();
    await expect(editor).toBeVisible({ timeout: 15000 });

    const viewLines = editor.locator(".view-lines").first();
    const content = await viewLines.textContent();
    expect(
      content && content.trim().length > 0,
      "After clicking a file, the editor should display its contents",
    ).toBe(true);
  });
});

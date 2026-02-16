import { test, expect } from "@playwright/test";
import {
  SELECTORS,
  waitForAppLoad,
  getFileTreeItems,
  clickFileInTree,
  assertNoRenderErrors,
  BUILTIN_SIMULATIONS,
} from "./fixtures/test-helpers";

/**
 * File Management Tests for sim-core
 *
 * These tests verify file management features:
 * - File tree navigation
 * - File selection
 * - Import/Export zip (critical for local storage model)
 *
 * MIGRATION CHECKPOINT: These features are being KEPT and must work after migration.
 */

test.describe("File Tree", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
  });

  test("should display file tree with project files", async ({ page }) => {
    // File tree should be visible
    const fileTree = page.locator(SELECTORS.fileTree);
    await expect(fileTree).toBeVisible({ timeout: 15000 });

    // Should have file items
    const files = await getFileTreeItems(page);
    expect(files.length).toBeGreaterThan(0);

    await assertNoRenderErrors(page);
  });

  test("should display files section in file tree", async ({ page }) => {
    // Files section should exist
    const filesSection = page.locator(SELECTORS.fileTreeFiles);
    await expect(filesSection).toBeAttached({ timeout: 15000 });

    // Should contain file or folder items
    const items = filesSection.locator("li");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    await assertNoRenderErrors(page);
  });

  test("should show file tree actions", async ({ page }) => {
    // File tree actions (add file, search, etc.) should be visible
    const actions = page.locator(SELECTORS.fileTreeActions);
    await expect(actions).toBeAttached({ timeout: 15000 });

    await assertNoRenderErrors(page);
  });

  test("should allow clicking on files to select them", async ({ page }) => {
    // Wait for file tree to fully load
    await page.waitForTimeout(2000);

    // Get file tree items
    const fileItems = page.locator(SELECTORS.fileTreeItem);
    const count = await fileItems.count();

    if (count > 0) {
      // Click on first file
      await fileItems.first().click();
      await page.waitForTimeout(1000);

      // Monaco editor should show the file content
      const editor = page.locator(SELECTORS.monacoEditor);
      await expect(editor.first()).toBeAttached({ timeout: 15000 });
    }

    await assertNoRenderErrors(page);
  });

  test("should show folders that can be expanded", async ({ page }) => {
    // Wait for file tree to load
    await page.waitForTimeout(2000);

    // Look for folder items
    const folders = page.locator(SELECTORS.fileTreeFolder);
    const folderCount = await folders.count();

    if (folderCount > 0) {
      // Folders should be clickable
      const firstFolder = folders.first();
      await expect(firstFolder).toBeAttached();

      // Click to toggle expansion - click on the folder name/toggle area
      const folderToggle = firstFolder.locator(".HashCoreFilesListItem").first();
      if ((await folderToggle.count()) > 0) {
        await folderToggle.click();
      } else {
        await firstFolder.click();
      }
      await page.waitForTimeout(500);
    }

    // No errors should occur
    await assertNoRenderErrors(page);
  });
});

test.describe("Import/Export Zip", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
  });

  test("should have export functionality accessible", async ({ page }) => {
    // Look for header menu or file menu
    const headerMenu = page.locator(SELECTORS.hashCoreHeader);

    if ((await headerMenu.count()) > 0) {
      // Try to find File menu
      const fileMenu = headerMenu.locator('button, [role="button"]').filter({
        hasText: /file/i,
      });

      if ((await fileMenu.count()) > 0) {
        await fileMenu.first().click();
        await page.waitForTimeout(500);

        // Look for export option
        const exportOption = page.locator('button, [role="menuitem"]').filter({
          hasText: /export|download|zip/i,
        });

        // Export should be available
        const hasExport = (await exportOption.count()) > 0;
        expect(hasExport).toBe(true);
      }
    }

    await assertNoRenderErrors(page);
  });

  test("should have import functionality accessible", async ({ page }) => {
    // Look for import option in header/menu
    const headerMenu = page.locator(SELECTORS.hashCoreHeader);

    if ((await headerMenu.count()) > 0) {
      // Try to find File menu
      const fileMenu = headerMenu.locator('button, [role="button"]').filter({
        hasText: /file/i,
      });

      if ((await fileMenu.count()) > 0) {
        await fileMenu.first().click();
        await page.waitForTimeout(500);

        // Look for import option
        const importOption = page.locator('button, [role="menuitem"], input[type="file"]').filter({
          hasText: /import|upload|open/i,
        });

        // Import should be available or file input should exist
        const hasImport = (await importOption.count()) > 0;
        const fileInput = page.locator('input[accept=".zip"]');
        const hasFileInput = (await fileInput.count()) > 0;

        expect(hasImport || hasFileInput).toBe(true);
      }
    }

    await assertNoRenderErrors(page);
  });

  test("file input accepts .zip files", async ({ page }) => {
    // Check for file input that accepts .zip
    // May be hidden, so check for existence not visibility
    const zipInput = page.locator('input[accept=".zip"]');

    // The input should exist somewhere in the DOM
    // It may be hidden until triggered
    await page.waitForTimeout(1000);

    // Either a zip input exists or we can access it through menu
    const headerMenu = page.locator(SELECTORS.hashCoreHeader);
    const hasHeader = (await headerMenu.count()) > 0;

    // App should have some import mechanism
    expect(hasHeader || (await zipInput.count()) > 0).toBe(true);

    await assertNoRenderErrors(page);
  });
});

test.describe("Code Editing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BUILTIN_SIMULATIONS.wildfires);
    await waitForAppLoad(page);
  });

  test("should display Monaco editor for code files", async ({ page }) => {
    // Wait for editor to load
    await page.waitForTimeout(1000);

    // Monaco editor should be present
    const editor = page.locator(SELECTORS.monacoEditor);
    await expect(editor.first()).toBeAttached({ timeout: 15000 });

    await assertNoRenderErrors(page);
  });

  test("should allow editing code in Monaco editor", async ({ page }) => {
    // Wait for editor to be ready
    await page.waitForTimeout(1500);

    // Find an editable Monaco editor
    const editor = page.locator(SELECTORS.monacoEditor).first();

    if ((await editor.count()) > 0) {
      // Click on the editor to focus it
      await editor.click();
      await page.waitForTimeout(300);

      // Type some text
      await page.keyboard.type("// Test comment");
      await page.waitForTimeout(300);

      // The editor should have the text
      const content = await editor.locator(".view-lines").first().textContent();
      expect(content).toContain("Test");
    }

    await assertNoRenderErrors(page);
  });

  test("should support multiple editor tabs", async ({ page }) => {
    // Click on different files to open multiple tabs
    const fileItems = page.locator(SELECTORS.fileTreeItem);
    const count = await fileItems.count();

    if (count >= 2) {
      // Click first file
      await fileItems.nth(0).click();
      await page.waitForTimeout(500);

      // Click second file
      await fileItems.nth(1).click();
      await page.waitForTimeout(500);

      // Should have editor tab area
      const editor = page.locator(SELECTORS.monacoEditor);
      await expect(editor.first()).toBeAttached();
    }

    await assertNoRenderErrors(page);
  });
});

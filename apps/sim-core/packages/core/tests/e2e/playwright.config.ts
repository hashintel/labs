import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Test Configuration for sim-core
 *
 * These tests serve as regression tests during migration phases:
 * - Redux removal
 * - React 16 → 18 upgrade
 * - Build tooling updates
 *
 * Run with: yarn test:e2e
 *
 * By default E2E uses the dev server (yarn serve). For production-build
 * runs set E2E_USE_BUILD=1 or use yarn test:e2e:build.
 *
 * IMPORTANT: Tests run sequentially with 1 worker to avoid overwhelming
 * the server and the host machine. The WASM simulation engine and
 * WebGL 3D viewer are resource-intensive; parallel workers cause freezes.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",

  /* Sequential execution — simulation tests are CPU-heavy (WASM + WebGL) */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry failed tests once (CI gets 2 retries) */
  retries: process.env.CI ? 2 : 1,

  /* Reporter to use */
  reporter: [["html", { open: "never" }], ["list"]],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.BASE_URL || "http://localhost:8080",

    /* Collect trace only when retrying — avoids overhead on first run */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Disable video recording to reduce resource usage */
    video: "off",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    // Uncomment for cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Timeout for each test - simulation can be slow */
  timeout: 90000,

  /* Timeout for each expect() assertion */
  expect: {
    timeout: 10000,
  },

  /* Dev server by default; set E2E_USE_BUILD=1 for production build + preview */
  webServer: {
    command:
      process.env.E2E_USE_BUILD === "1"
        ? "yarn build && vite preview"
        : "yarn serve",
    cwd: __dirname.replace(/[\\\/]tests[\\\/]e2e$/, ""), // Run from packages/core directory
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout:
      process.env.E2E_USE_BUILD === "1" ? 300000 : 120000, // build is slower
    stdout: "pipe",
    stderr: "pipe",
  },
});

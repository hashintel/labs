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
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",

  /* Run tests in files in parallel - limited to avoid overwhelming dev server */
  fullyParallel: false, // Disabled: simulation tests can interfere with each other
  workers: 2, // Limit workers to reduce server load

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: [["html", { open: "never" }], ["list"]],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.BASE_URL || "http://localhost:8080",

    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video on failure */
    video: "on-first-retry",
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

  /* Retry failed tests once */
  retries: 1,

  /* Timeout for each expect() assertion */
  expect: {
    timeout: 10000,
  },

  /* Run local dev server before starting the tests */
  webServer: {
    command: "yarn serve",
    cwd: __dirname.replace(/[\\\/]tests[\\\/]e2e$/, ""), // Run from packages/core directory
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes for WASM compilation
    stdout: "pipe",
    stderr: "pipe",
  },
});

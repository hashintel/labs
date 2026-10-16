module.exports = {
  preset: "jest-puppeteer",
  globals: {
    HCORE_URL: process.env.HCORE_URL || "https://core.hash.ai"
  },
  "testRunner": "jest-circus/runner",
  testMatch: ["**/e2e/**/*.test.js"],
  testTimeout: process.env.SLOWMO ? 90000 : 60000,
  verbose: true
};
// This test uses @hash/boids-3d as a logged out user and tests whether:
// 1. Discord button is available 

describe("Sanity checks / Discord", () => {
  jest.retryTimes(3);
  beforeAll(async () => {
    await page.goto(`${HCORE_URL}/@hash/boids-3d`, {
      waitUntil: "load",
    });
    await page.waitForSelector(".HashCoreHeaderMenu-item"); // wait until most of the app has rendered before checking
  });

  test("Discord button is visible", async () => {
    await page.waitForSelector('a.DiscordWidget');
  });
});

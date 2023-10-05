const { atLeastOneExists, expectProjectTitleToMatch }= require("../utils");

// This test uses @hash/boids-3d as a logged out user and tests whether:
// 1. Title matches
// 2. Specific vendor Javascript files are loaded

let scripts;
describe("Sanity checks / Metadata", () => {
  jest.retryTimes(3);
  beforeAll(async () => {
    await page.goto(`${HCORE_URL}/@hash/boids-3d`, {
      waitUntil: "load",
    });
    await page.waitForSelector(".HashCoreHeaderMenu-item"); // wait until most of the app has rendered before checking
    scripts = await page.$$eval("head > script", elHandles => elHandles.map(({ src }) => src));
  });

  test('Loaded at least one script', async () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  test("Title matches", async () => {
    await expectProjectTitleToMatch(page, 'Boids 3D');
    const title = await page.title();
    expect(title).toBe("HASH Core - Boids 3D");
  });

  test("Loads pingdom", async () => {
    expect(atLeastOneExists(scripts,'pingdom.net')).toBeTruthy();      
  });
  test("Loads Google Analytics", async () => {
    expect(atLeastOneExists(scripts,'google-analytics.com')).toBeTruthy();      
  });
  test("Loads Segment", async () => {
    expect(atLeastOneExists(scripts,'segment.com')).toBeTruthy();      
  });
  test("Loads HASH Browser Check", async () => {
    expect(atLeastOneExists(scripts,'https://hash.ai/browser-check')).toBeTruthy();      
  });

  test.todo('Logs in and loads FullStory');
  // test("Loads FullStory", async () => {
  //   await saveProjectUsingKeyboard(page); // will redirect to login
  //   await login(page);
  //   scripts = await page.$$eval("head > script", elHandles => elHandles.map(({ src }) => src));
  //   console.log(scripts);
  //   expect(atLeastOneExists(scripts,'fullstory.com')).toBeTruthy();      
  // });
});

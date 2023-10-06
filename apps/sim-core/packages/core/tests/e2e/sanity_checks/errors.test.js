// Tests:
// 1. That non-existing simulations show a matching title
// 2. That non-existing simulations show a matching copy explaining that it was not found
// 2. Specific vendor Javascript files are loaded
describe("Sanity checks / Errors", () => {
  jest.retryTimes(3);
  beforeAll(async () => {
    await page.goto(`${HCORE_URL}/@hash/this-does-not-exist-${Math.random()}`, {
      waitUntil: "load",
    });
  });

  test("Title matches", async () => {
    const title = await page.title();
    expect(title).toBe("HASH Core");
  });

  test("Not found page", async () => {
    await page.waitForSelector('h2');
    await page.waitForSelector('h3');
    expect(await page.$eval('h2', (el) => el.innerText)).toBe('Not Found');
    expect(await page.$eval('h3', (el) => el.innerText)).toBe('The simulation you are looking for cannot be found.');
  });

});

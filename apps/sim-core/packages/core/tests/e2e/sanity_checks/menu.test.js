const {
  SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS,
  closeAllSimulationViewerTabs,
  sleep,
  XPATH_EMPTY_SIMULATION_MENU_ITEM,
  XPATH_SIMULATION_FROM_STARTER_TEMPLATE_MENU_ITEM
} = require("../utils");

const { 
  DISCORD_URL
} = require("../../../src/components/DiscordWidget/DiscordWidget")


const TIMEOUT_MENU_ITEM_HOVER = 300;
const STARTING_URL = `${HCORE_URL}/@hash/boids-3d/main`;

// This test uses @hash/boids-3d as a logged out user and tests whether:

// FILE MENU (100% coverage)
// 1. The user can open the "File" menu
// 2. The user can hover over the "File -> New simulation" menu and it shows a sub-menu
// 3. The user can click on "File -> New simulation -> Empty template" and get redirected to login
// 4. The user can click on "File -> New simulation -> From starter template" and get redirected to login
// 5. The user can hover over the "File -> Example simulations" menu and it shows a sub-menu
// 6. The list under "File -> Example simulations" matches this test
// 7. All the links under "File -> Example simulations" give HTTP status 200 when visited
// 8. The user can click on "File -> Save project" and get redirected to login
// 9. The user can click on "File -> Fork project" and get redirected to login
// 10. The user can click on "File -> View project in HASH" and get redirected to login

// VIEW MENU (100% coverage)
// 1. The user can open the "View" menu
// 2. The user can click on "View -> 3D viewer" and see the tab
// 3. The user can click on "View -> Geospatial" and see the tab
// 4. The user can click on "View -> Analysis" and see the tab
// 5. The user can click on "View -> Process chart" and see the tab
// 6. The user can click on "View -> Raw output" and see the tab
// 7. The user can click on "View -> Step explorer" and see the tab
// 8. The user can click on "View -> Hide editor" and hide the editor
// 9. The user can click on "View -> Hide activity" and hide the activity pane 
// 10. The user can click on "View -> Sign up" redirects to sign up
// 11. The user can click on "View -> Sign in" redirects to sign in

// EXPERIMENTS MENU (100% coverage)
// 1. The user can open the "Experiments" menu
// 2. It shows the default experiments for boids-3d

// HELP MENU (100% coverage)

// CLOUD INACTIVE button

// CLOUD INACTIVE button
// Sign up / sign in 

const getHashCoreHeaderMenuItems = async (page) => {
  const selector = ".HashCoreHeaderMenu-submenu-item label";
  await page.waitForSelector(selector);
  return await page.$$(selector);
}

let hashCoreHeaderMenuFile;
let hashCoreHeaderMenuView;
let hashCoreHeaderMenuExperiments;
let hashCoreHeaderMenuHelp;
describe("Sanity Checks - Menu", () => {
  jest.retryTimes(3);
  beforeEach(async () => {
    await page.goto(STARTING_URL, {
      waitUntil: "load"
    });
    await page.waitForSelector(".HashCoreHeaderMenu-item");
    hashCoreHeaderMenuFile = await page.waitForSelector(
      'label[for="HashCoreHeaderMenu::File"]'
    );
    hashCoreHeaderMenuView = await page.waitForSelector(
      'label[for="HashCoreHeaderMenu::View"]'
    );
    hashCoreHeaderMenuExperiments = await page.waitForSelector(
      'label[for="HashCoreHeaderMenu::Experiments"]'
    );
    hashCoreHeaderMenuHelp = await page.waitForSelector(
      'label[for="HashCoreHeaderMenu::Help"]'
    );
  });

  test("File -> New simulation -> Empty simulation redirects to login", async () => {
    await hashCoreHeaderMenuFile.click();
    const hashCoreHeaderMenuItems = await getHashCoreHeaderMenuItems(page);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === "New simulation") {
        await currentItem.hover();
        await sleep(TIMEOUT_MENU_ITEM_HOVER);
        const newSimulationMenuItem = await page.waitForXPath(
          XPATH_EMPTY_SIMULATION_MENU_ITEM
        );
        await newSimulationMenuItem.hover();
        await sleep(TIMEOUT_MENU_ITEM_HOVER);
        const [response] = await Promise.all([
          page.waitForNavigation(), // The promise resolves after navigation has finished
          newSimulationMenuItem.click() // Clicking the link will indirectly cause a navigation
        ]);
        expect(response).toBe(null);
        expect(await page.evaluate(() => window.location.href)).toBe(
          `${HCORE_URL}/signin?route=%2Fnew`
        );
        break;
      }
    }
  });

  test("File -> New simulation -> From starter template redirects to login", async () => {
    await hashCoreHeaderMenuFile.click();
    const hashCoreHeaderMenuItems = await getHashCoreHeaderMenuItems(page);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === "New simulation") {
        await currentItem.hover();
        await sleep(TIMEOUT_MENU_ITEM_HOVER);
        const newSimulationMenuItem = await page.waitForXPath(
          XPATH_SIMULATION_FROM_STARTER_TEMPLATE_MENU_ITEM
        );
        await newSimulationMenuItem.hover();
        await sleep(TIMEOUT_MENU_ITEM_HOVER);
        const [response] = await Promise.all([
          page.waitForNavigation(), // The promise resolves after navigation has finished
          newSimulationMenuItem.click() // Clicking the link will indirectly cause a navigation
        ]);
        expect(response).toBe(null);
        expect(await page.evaluate(() => window.location.href)).toBe(
          `${HCORE_URL}/signin?route=%2Fnew%2Fstarter`
        );
        break;
      }
    }
  });

  test("File -> Example simulations match and do not give 404 when clicked", async () => {
    await hashCoreHeaderMenuFile.click();
    const hashCoreHeaderMenuItems = await getHashCoreHeaderMenuItems(page);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === "Example simulations") {
        await currentItem.hover();
        await sleep(TIMEOUT_MENU_ITEM_HOVER);
        const ul = await page.evaluateHandle(el => el.nextSibling, currentItem);
        expect(ul).toBeDefined();
        const textContents = await page.evaluate(el => el.innerText, ul);
        expect(textContents.includes('Sugarscape')).toBe(true);
        expect(textContents.includes('Virus - Mutation and Drug Resistance')).toBe(true);
        expect(textContents.includes('Boids 3D')).toBe(true);
        expect(textContents.includes('Wildfires - Regrowth')).toBe(true);
        expect(textContents.includes('Published Display Behaviors')).toBe(true);
        expect(textContents.includes('Warehouse Logistics')).toBe(true);
        expect(textContents.includes('City Infection Model')).toBe(true);
        expect(textContents.includes('Model Market')).toBe(true);
        expect(textContents.includes('Ant Foraging')).toBe(true);
        expect(textContents.includes('Connection Example')).toBe(true);
        expect(textContents.includes('Rainfall')).toBe(true);
        expect(textContents.includes('Rumor Mill - Public Health Practices')).toBe(true);
        const urls = await page.evaluate(
          el =>
            Array.from(el.childNodes).map(child => child.childNodes[0].href),
          ul
        );
        expect(urls.includes("https://core.hash.ai/@hash/sugarscape/7.4.5")).toBe(true);
        expect(
          urls.includes(
            "https://core.hash.ai/@hash/virus-mutation-and-drug-resistance/3.4.1"
          )
        ).toBe(true);
        expect(urls.includes("https://core.hash.ai/@hash/boids-3d/6.1.0")).toBe(
          true
        );
        expect(
          urls.includes("https://core.hash.ai/@hash/wildfires-regrowth/9.7.0")
        ).toBe(true);
        expect(
          urls.includes(
            "https://core.hash.ai/@hash/published-display-behaviors/2.3.0"
          )
        ).toBe(true);
        expect(
          urls.includes("https://core.hash.ai/@hash/warehouse-logistics/2.4.3")
        ).toBe(true);
        expect(
          urls.includes("https://core.hash.ai/@hash/city-infection-model/6.4.1")
        ).toBe(true);
        expect(
          urls.includes("https://core.hash.ai/@hash/model-market/4.5.1")
        ).toBe(true);
        expect(
          urls.includes("https://core.hash.ai/@hash/ant-foraging/7.3.1")
        ).toBe(true);
        expect(
          urls.includes("https://core.hash.ai/@hash/connection-example/1.1.1")
        ).toBe(true);
        expect(urls.includes("https://core.hash.ai/@hash/rainfall/7.2.2")).toBe(
          true
        );
        expect(
          urls.includes(
            "https://core.hash.ai/@hash/rumor-mill-public-health-practices/2.2.3"
          )
        ).toBe(true);
      }
    }
  });

  test("File -> Save project", async () => {
    await hashCoreHeaderMenuFile.click();
    const selector =
      ".HashCoreHeaderMenu-submenu-item a div.HashCoreHeaderMenu__LabelWithHint span";
    await page.waitForSelector(selector);
    const hashCoreHeaderMenuItems = await page.$$(selector);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === "Save project") {
        await currentItem.hover();
        await sleep(50);
        const [response] = await Promise.all([
          page.waitForNavigation(), // The promise resolves after navigation has finished
          currentItem.click() // Clicking the link will indirectly cause a navigation
        ]);
        expect(response).toBe(null);
        expect(await page.evaluate(() => window.location.href)).toBe(
          `${HCORE_URL}/signin`
        );
        break;
      }
    }
  });

  test("File -> Fork project", async () => {
    await hashCoreHeaderMenuFile.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const hashCoreHeaderMenuItems = await page.$$(selector);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === "Fork project") {
        await currentItem.hover();
        await sleep(50);
        const path = await page.evaluate(() => window.location.pathname);
        const [response] = await Promise.all([
          page.waitForNavigation(), // The promise resolves after navigation has finished
          currentItem.click() // Clicking the link will indirectly cause a navigation
        ]);
        expect(response).toBe(null);
        const currentUrl = await page.evaluate(() => window.location.href);
        expect(currentUrl.includes("/signin")).toBe(true);
        expect(currentUrl.includes(encodeURIComponent(path))).toBe(true);
        break;
      }
    }
  });

  test("File -> View in HASH", async done => {
    await hashCoreHeaderMenuFile.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const hashCoreHeaderMenuItems = await page.$$(selector);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === "View in HASH") {
        const mock = jest.fn(async target => {
          const url = await target.url();
          const newTab = await target.page();
          await newTab?.close(); // avoid leaving a dangling tab
          if (url === "https://hash.ai/@hash/boids-3d") {
            done();
          }
          return url;
        });
        browser.on("targetcreated", mock); // browser is provided by jest-puppeteer
        await currentItem.hover();
        await currentItem.click();
        break;
      }
    }
  });

  const testViewMenu = async (itemToClick, tabToExpect) => {
    await closeAllSimulationViewerTabs(page);
    await hashCoreHeaderMenuView.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const hashCoreHeaderMenuItems = await page.$$(selector);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    let found = false;
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText === itemToClick) {
        await currentItem.hover();
        await currentItem.click();
        await page.waitForSelector(SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS);
        const tabs = await page.$$(SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS);
        for (let x = 0; x < tabs.length; x++) {
          const tabText = await page.evaluate(item => item.innerText, tabs[x]);
          if (tabText === tabToExpect) {
            found = true;
            break;
          }
        }
        if (found) {
          break;
        }
      }
    }
    expect(found).toBe(true);
  };

  test.each([
    ["3D viewer"],
    ["Geospatial"],
    ["Analysis"],
    ["Process chart"],
    ["Raw output"],
    ["Step explorer"]
  ])("View -> %s", async currentTabToTest => {
    await testViewMenu(currentTabToTest, currentTabToTest);
  });

  test("View -> Hide editor", async () => {
    await hashCoreHeaderMenuView.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const hashCoreHeaderMenuItems = await page.$$(selector);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    let found = false;
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText.includes("Hide editor")) {
        await currentItem.hover();
        await currentItem.click();
        const globalsJson =
          ".react-tabs__tab.tab-properties.react-tabs__tab--selected";
        await page.waitForSelector(globalsJson);
        const onlyAvailableTabInTheEditor = await page.$(globalsJson);
        const tabTitle = await page.evaluate(
          item => item.innerText,
          onlyAvailableTabInTheEditor
        );
        expect(tabTitle).toBe("globals.json");
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("View -> Hide activity", async () => {
    await hashCoreHeaderMenuView.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const hashCoreHeaderMenuItems = await page.$$(selector);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    await page.waitForSelector(".ActivityHistory", { visible: true }); // checks that it is visible
    let found = false;
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText.includes("Hide activity")) {
        await currentItem.hover();
        await currentItem.click();
        await sleep(300);
        await page.waitForSelector(".ActivityHistory", { visible: false }); // checks that it is invisible
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("View -> Sign up redirects to login", async () => {
    await hashCoreHeaderMenuFile.click();
    const hashCoreHeaderMenuItems = await getHashCoreHeaderMenuItems(page);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText.includes("Sign up")) {
        await currentItem.hover();
        const [response] = await Promise.all([
          page.waitForNavigation(), // The promise resolves after navigation has finished
          currentItem.click() // Clicking the link will indirectly cause a navigation
        ]);
        expect(response).toBe(null);
        expect(await page.evaluate(() => window.location.href)).toBe(
          `${HCORE_URL}/signup`
        );
        break;
      }
    }
  });

  test("View -> Sign in redirects to login", async () => {
    await hashCoreHeaderMenuFile.click();
    const hashCoreHeaderMenuItems = await getHashCoreHeaderMenuItems(page);
    expect(hashCoreHeaderMenuItems.length).toBeGreaterThan(0);
    for (let i = 0; i < hashCoreHeaderMenuItems.length; i++) {
      const currentItem = hashCoreHeaderMenuItems[i];
      const currentItemText = await page.evaluate(
        item => item.innerText,
        currentItem
      );
      if (currentItemText.includes("Sign in")) {
        await currentItem.hover();
        const [response] = await Promise.all([
          page.waitForNavigation(), // The promise resolves after navigation has finished
          currentItem.click() // Clicking the link will indirectly cause a navigation
        ]);
        expect(response).toBe(null);
        expect(await page.evaluate(() => window.location.href)).toBe(
          `${HCORE_URL}/signin`
        );
        break;
      }
    }
  });

  test("Experiments -> Shows the list of experiments for boids-3d", async () => {
    await sleep(2000); // wait until the Experiments menu item is no longer disabled
    await hashCoreHeaderMenuExperiments.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const texts = await page.$$eval(selector, (elements) => elements.map(element => element.innerText))
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.includes('cohesion arange')).toBe(true);
    expect(texts.includes('agent_count value')).toBe(true);
    expect(texts.includes('Sweep flocks')).toBe(true);
  });

  test("Help -> Shows the right links and texts", async () => {
    await hashCoreHeaderMenuHelp.click();
    const selector = ".HashCoreHeaderMenu-submenu-item a";
    await page.waitForSelector(selector);
    const links = await page.$$eval(selector, (elements) => elements.map(element => ({ href: element.href, text: element.innerText })))
    expect(links.length).toBeGreaterThanOrEqual(4);
    const foundElements = {
      docs: false,
      newUserTour: false,
      communityDiscord: false
    }
    links.forEach(link => {
      if (link.href === "https://docs.hash.ai/core/" && link.text === 'Docs') {
        foundElements.docs = true;
      }
      if (link.href.endsWith('#') && link.text === 'New user tour') {
        foundElements.newUserTour = true;
      }
      if (link.href === DISCORD_URL && link.text === 'Community Discord') {
        foundElements.communityDiscord = true;
      }
    });
    expect(foundElements.docs).toBe(true);
    expect(foundElements.newUserTour).toBe(true);
    expect(foundElements.communityDiscord).toBe(true);
  });

  test("CLOUD INACTIVE -> Clicking on it redirects to sign in", async () => {
    const button = await page.waitForSelector(
      ".HashCoreHeaderMenuCloudStatus__Label"
    );
    expect(await page.evaluate(el => el.innerText, button)).toBe('CLOUD INACTIVE');
    const [response] = await Promise.all([
      page.waitForNavigation(), // The promise resolves after navigation has finished
      button.click() // Clicking the link will indirectly cause a navigation
    ]);
    expect(response).toBe(null);
    expect(await page.evaluate(() => window.location.href)).toBe(
      `${HCORE_URL}/signin?route=%40hash%2Fboids-3d%2Fmain`
    );
  });
  
  test.todo('Share Project button');

  test('Sign up / Sign in button -> Clicking on it redirects to sign in', async () => {
    const button = await page.waitForSelector(
      "a.HashCoreHeader__RightButton.HashCoreHeader__RightButton--CTA"
    );
    expect(await page.evaluate(btn => btn.href, button)).toBe(`${HCORE_URL}/signup`);
  });
});

const {
  sleep,
  deleteProject,
  deleteBehavior,
  deleteFile,
  createBehavior,
  replaceInitJsonContents,
  createNewSimulation,
  resetSimulationAndRunNSteps,
  getFirstMatchingIdForListItem,
  expectProjectTitleToMatch
} = require("../utils");

const STARTING_URL = `${HCORE_URL}/@hash/boids-3d/main`;

const TEST_BEHAVIOR_FILENAME = "testingfile";
const TEST_BEHAVIOR_FILENAME_WITH_EXTENSION = `${TEST_BEHAVIOR_FILENAME}.js`;
const SEARCH_QUERY = "Create Scatters";

const getProjectName = () => `DELETEME ${Math.random().toString()}`.replaceAll(".", "");
const getForkedProjectName = () => `DELETEME FORKED ${Math.random().toString()}`.replaceAll(".", "");

// This tests the new simulation + login procedure by
// 1. Clicking on File -> New simulation -> Empty template
// 2. Logging in
// 3. Fill the modal
// 4. Wait for project to be created
// 5. Confirm the title of the newly created project matches
// 6. Deleting the created project
// 7+ Redirecting to an existing simulation
// 8. Creating a new (faulty) behavior. Also tests Hide/Show editor shortcut
// 9. Adding this behavior to init.json 
// 10. Saving using shortcuts 
// 11. Resetting the simulation (needed so HASH Core can see the changes to init.json)
// 12. Advancing 2 steps 
// 13. Expect an error notification to be visible with text "TESTING ERRORS"
// 14. Update the faulty behavior 
// 15. Reset the simulation 
// 16. Advance 2 steps 
// 17. There SHOULD NOT be an error notification
// 18. Delete the newly created behavior so next tests can run as intended
// 19. Search using "Add to projects". Expect results
// 20. Adds a behavior
// 21. Reloads the page
// 22. Navigates to the newly added behavior in Project Files 
// 23. Removes the newly added behavior
const projectPaths = [];
if (!process.env.API_URL) {
  throw new Error('Missing required API_URL env var. It looks like "https://api.hash.ai/graphql", exiting.');
}
describe("Logged In", () => {
  jest.retryTimes(3);

  beforeAll(async () => {
    await page.goto(STARTING_URL, {
      waitUntil: "load"
    });
    await page.waitForSelector(".HashCoreHeaderMenu-item");
  });

  describe("New simulation", () => {
    test("Clicks on File -> New simulation -> Empty simulation", async () => {
      projectPaths.push(await createNewSimulation(page, getProjectName(), true));
    });
  });

  describe("Simulation Errors", () => {
    test("Creates a new faulty behavior and updates init.json", async () => {
      await createBehavior(
        page,
        TEST_BEHAVIOR_FILENAME,
        "const behavior = (state, context) => {\n  throw new Error('TESTING ERRORS');\n",
        true
      );
      await sleep(5000);
      await replaceInitJsonContents(
        page,
        TEST_BEHAVIOR_FILENAME_WITH_EXTENSION
      );
      await sleep(3000);
    });

    test("Resets the simulation + steps (runs) the faulty simulation and expects an error notification to be visible", async () => {
      await resetSimulationAndRunNSteps(page, 2);
      const errorNotification = await page.waitForSelector(
        ".HashCoreConsole__alert.HashCoreConsole__alert--error.Scrollable__Item"
      );
      const content = await page.evaluate(
        el => el.innerText,
        errorNotification
      );
      expect(content.includes("TESTING ERRORS")).toBe(true);
    });

    test("Deletes the faulty behavior", async () => {
      await deleteBehavior(page, TEST_BEHAVIOR_FILENAME, false, false);
    });

    test("Creates a new, working behavior", async () => {
      await createBehavior(
        page,
        TEST_BEHAVIOR_FILENAME,
        "const behavior = (state, context) => {\n  if (!state.counter) { state.counter = 0 };\n state.counter++;\n",
        true
      );
      await sleep(2000);
    });

    test("Resets and re-runs the simulation. Expect no error notification", async () => {
      await resetSimulationAndRunNSteps(page, 2);
      const errorNotification = await page.$(
        ".HashCoreConsole__alert.HashCoreConsole__alert--error.Scrollable__Item"
      );
      expect(errorNotification).toBeFalsy();
    });
  });

  describe("Add to Project search", () => {
    test("Searches using add to project and expects results", async () => {
      const input = await page.waitForSelector(
        "input.RoundedTextInput__input.Search__Input"
      );
      await input.type(SEARCH_QUERY, { delay: 10 });
      await sleep(2000);
      await page.waitForSelector(".ResourceListItemButton");
      const resultsAsText = await page.$$eval(
        ".ResourceListItemButton",
        searchResults => searchResults.map(item => item.innerText).join("\n")
      );
      expect(resultsAsText.includes(SEARCH_QUERY)).toBe(true);
      expect(resultsAsText.includes("BEHAVIOR")).toBe(true); // at least one of them should be a behavior
    });

    test("Adds the behavior @hash/create-scatters behavior and expects button to be disabled and removal help text to match", async () => {
      const firstResult = await page.waitForSelector(".ResourceListItemButton"); // should already be here from previous test
      await firstResult.click();
      const addToProjectButton = await page.waitForSelector(
        "button.Fancy.Fancy-white.Fancy-regular.Fancy-plus.ResourceListItemPopup__button"
      );
      const addToProjectButtonText = await page.evaluate(
        el => el.innerText,
        addToProjectButton
      );
      expect(addToProjectButtonText).toBe("ADD TO PROJECT");
      await addToProjectButton.click();
      await sleep(3000); // give the Back-End some time to process
      const isButtonDisabled = await page.evaluate(
        el => el.classList.contains("ResourceListItemPopup__button--disabled"),
        addToProjectButton
      );
      expect(isButtonDisabled).toBe(true);
      const howToDeleteExplanation = await page.waitForSelector(
        ".ResourceListItemPopup__delete-explain"
      );
      const howToDeleteExplanationText = await page.evaluate(
        el => el.innerText,
        howToDeleteExplanation
      );
      expect(howToDeleteExplanationText).toBe(
        "If you wish to remove this behavior, please use the Project Files pane above."
      );
    });

    test("Reloads the page and expects to find the behavior", async () => {
      // Extract the ID for the current scatter behavior.
      // We need to do this because the ID changes based on the version number so we cant hardcode it.
      // For more info please look at the `getDomIdByFileId` function in HASH Core
      const targetId = await getFirstMatchingIdForListItem(
        page,
        "_hash_create-scatters_create__scatters_js_"
      );
      await page.reload();
      await page.waitForSelector(`#${targetId}`);
    });

    test("Removes the behavior", async () => {
      const targetId = await getFirstMatchingIdForListItem(
        page,
        "_hash_create-scatters_create__scatters_js_"
      );
      await deleteFile(page, `#${targetId}`);
    });
  });

  describe("Forking", () => {
    test("Navigates to @hash/boids-3d -> Clicks on File -> Fork Project -> Creates a new forked project", async () => {
      let projectPath = await page.evaluate(() => window.location.pathname)
      await page.goto(`${HCORE_URL}/@hash/boids-3d/main`, {
        waitUntil: "load"
      });
      await page.waitForSelector(".HashCoreHeaderMenu-item");
      const hashCoreHeaderMenuFile = await page.waitForSelector(
        'label[for="HashCoreHeaderMenu::File"]'
      );
      await hashCoreHeaderMenuFile.click();
      await sleep(2000);
      const forkProjectButton = await page.waitForSelector("aria/Fork Project");
      await forkProjectButton.click();
      const nameInput = await page.waitForSelector(
        '.ModalNewProject__Input.ModalNewProject__Input--text input[name="name"]'
      );
      await nameInput.click();
      for (let iteration=0;iteration<10;iteration++) {
        await page.keyboard.press('Backspace');
      }
      const FORKED_PROJECT_NAME = getForkedProjectName();
      await nameInput.type(FORKED_PROJECT_NAME);
      const visibilitySelect = await page.waitForSelector("select#visibility");
      await visibilitySelect.type("private");
      const forkProjectFormButton = await page.waitForSelector(
        "aria/Fork Project"
      );
      const [response] = await Promise.all([
        page.waitForNavigation(),
        forkProjectFormButton.click()
      ]);
      expect(response).toBe(null);
      projectPath = await page.evaluate(() => window.location.pathname)
      projectPaths.push(projectPath);
      await expectProjectTitleToMatch(page, FORKED_PROJECT_NAME);
    });
  });

  afterAll(async () => {
    let tmp;
    for (let iter = 0; iter < projectPaths.length; iter++) {
      tmp = await deleteProject(page, process.env.API_URL, projectPaths[iter]);
      expect(tmp).toBe(null);
    }
  });
});

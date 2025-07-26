// TODO: move all these to constants.js and leave utils only for fns
const SELECTOR_STEP_SIMULATION_BUTTON = "div.step.simulation-control";
const SELECTOR_RESET_SIMULATION_BUTTON = "div.reset.simulation-control";
const SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS = 'li.react-tabs__tab';
const SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS_CLOSE_BUTTON = 'li.react-tabs__tab button.tab-button';

const sleep = (time) => new Promise(function (resolve) {
  setTimeout(resolve, time);
});

const atLeastOneExists = (inputArray, searchString) => inputArray.filter(element => element.indexOf(searchString) !== -1).length >= 1;
const deleteProject = async (page, url, projectPath) => {
  if (!page || !url || !projectPath) {
    throw new Error('Called utils/deleteProject without page, url or projectPath, exiting.');
  } 
  const body = {
    operationName: "deleteProject",
    variables: { projectPath },
    query:
      "mutation deleteProject($projectPath: String!) {\n  deleteProject(projectPath: $projectPath)\n}\n"
  };
  const result = await page.evaluate(async (data, url) => {
    const response = await fetch(url, {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      mode: "cors", // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      credentials: "include", // include, *same-origin, omit
      headers: {
        "Content-Type": "application/json"
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: "follow", // manual, *follow, error
      referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
      body: JSON.stringify(data) // body data type must match "Content-Type" header
    });
    return response.json(); // parses JSON response into native JavaScript objects
  }, body, url);
  return result;
};
const login = async (page) => {
  if (!page) {
    throw new Error('utils/login: Missing required parameter page.');
  }
  const EMAIL = process.env.TEST_ACCOUNT_EMAIL;
  const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD;
  if (!EMAIL || !PASSWORD) {
    throw new Error('utils/login: Missing required TEST_ACCOUNT_EMAIL and/or TEST_ACCOUNT_PASSWORD env vars, exiting.');
  }
  // wait until the iframe is available
  await page.waitForSelector('iframe.ModalSignin__Frame');
  const frames = page.mainFrame().childFrames();
  if (frames.length === 0) {
    throw new Error('There are no child frames in the current page. Maybe the login page has not loaded yet?');
  }
  const frame = frames[0];
  const emailInput = await frame.waitForSelector("aria/Email");
  await emailInput.click();
  await emailInput.type(EMAIL);
  const passwordInput = await frame.waitForSelector("aria/Password");
  await passwordInput.type(PASSWORD);
  const logInButton = await frame.waitForSelector("aria/Log In");
  await logInButton.click();
};
const createNewSimulation = async (page, projectName, shouldLogin = false) => {
  if (!page || !projectName) {
    throw new Error('utils/createNewSimulation: Missing required parameters');
  }
  const hashCoreHeaderMenuFile = await page.waitForSelector(
    'label[for="HashCoreHeaderMenu::File"]'
  );
  await hashCoreHeaderMenuFile.click();
  await sleep(2000);
  const newSimulationButton = await page.waitForSelector(
    'label[for="HashCoreHeaderMenu-submenu::New simulation"]'
  );
  await newSimulationButton.click();
  const emptySimulationButton = await page.waitForSelector(
    "aria/Empty simulation"
  ); // ul a:first-child
  await emptySimulationButton.click();
  if (shouldLogin) {
    await login(page);
    await sleep(2000);
  }
  const nameInput = await page.waitForSelector(
    '.ModalNewProject__Input.ModalNewProject__Input--text input[name="name"]'
  );
  await nameInput.click();
  await nameInput.type(projectName);
  const visibilitySelect = await page.waitForSelector("select#visibility");
  await visibilitySelect.type("private");
  const createNewSimulationFormButton = await page.waitForSelector(
    "aria/Create new simulation"
  );
  const [response] = await Promise.all([
    page.waitForNavigation(),
    createNewSimulationFormButton.click()
  ]);
  expect(response).toBe(null);
  projectPath = await page.evaluate(() => window.location.pathname);
  await expectProjectTitleToMatch(page, projectName);
  return projectPath;
};
const fakeFocusEditor = async (page) => {
  if (!page) {
    throw new Error('utils/fakeFocusEditor: Missing required parameters');
  }
  await toggleEditorUsingKeyboard(page);
  await sleep(1000);
  await toggleEditorUsingKeyboard(page);
  await sleep(1000);
};
const createBehavior = async (page, filename, behaviorContents, focusEditor = false) => {
  if (!page || !filename || !behaviorContents) {
    throw new Error('utils/createBehavior: Missing required parameters');
  }
  const newBehaviorButton = await page.waitForSelector(
    "button.HashCoreFilesHeaderAction"
  );
  await newBehaviorButton.click();
  const inputNameYourNewFile = await page.waitForSelector(
    "aria/Name your new file"
  );
  await inputNameYourNewFile.click();
  await inputNameYourNewFile.type(filename);
  await page.keyboard.press("Enter"); // submit
  await sleep(3000); // let the back-end do the work
  // TODO: Delete file
  if (focusEditor) {
    await fakeFocusEditor(page);
  }
  await selectContentsInTextAreaUsingKeyboard(page);
  await sleep(1000);
  await page.keyboard.type(behaviorContents, { delay: 10 });
  await saveProjectUsingKeyboard(page);
  await sleep(2000); // let the back-end do the work
};
const openSrcFolder = async (page) => {
  const srcFolder = await page.waitForSelector("li#HashCoreFilesListItemFolder-src > div > div > div");
  await srcFolder.click();
  await sleep(1000);
}
const openBehaviorsFolder = async (page) => {
  const behaviorsFolder = await page.waitForSelector("li#HashCoreFilesListItemFolder-src_behaviors > div > div > div");
  await behaviorsFolder.click();
  await sleep(1000);
};
const getFirstMatchingIdForListItem = async (page, stringThatShouldBeIncludedInTheId) => {
  if (!page || !stringThatShouldBeIncludedInTheId) {
    throw new Error('utils/getFirstMatchingIdForListItem: Missing required parameters');
  }
  return await page.evaluate((idToSearchFor) => {
    const items = Array.from(
      document.querySelectorAll(".HashCoreFilesListItemFile")
    );
    const filteredItems = items.filter(item =>
      item.id.includes(idToSearchFor)
    );
    return filteredItems[0].id;
  }, stringThatShouldBeIncludedInTheId);
};
const deleteFile = async (page, listItemSelector, shouldOpenSrcFolder = true, shouldOpenBehaviorsFolder = true) => {
  if (!page) {
    throw new Error('utils/deleteFile: Missing required parameters');
  }
  if (shouldOpenSrcFolder) {
    await openSrcFolder(page);
  }
  if (shouldOpenBehaviorsFolder) {
    await openBehaviorsFolder(page);
  }
  const testingFile = await page.waitForSelector(listItemSelector);
  await page.evaluateHandle(li => li.children[0].children[1].click(), testingFile);
  const deleteButton = await page.waitForSelector(".ModalConfirmFileDelete__buttons button:first-child");
  await deleteButton.click();
  await sleep(2000); // let the backend do the work
}
const deleteBehavior = async (page, behaviorFilename, shouldOpenSrcFolder = true, shouldOpenBehaviorsFolder = true) => {
  if (!page) {
    throw new Error('utils/deleteBehavior: Missing required parameters');
  }
  await deleteFile(page, `li#HashCoreFilesListItem-${behaviorFilename.toLowerCase()}_js_main`, shouldOpenSrcFolder, shouldOpenBehaviorsFolder);
};

const replaceInitJsonContents = async (page, behaviorFilenameWithExtension, shouldOpenSrcFolder = false) => {
  if (!page || !behaviorFilenameWithExtension) {
    throw new Error('utils/replaceInitJsonContents: Missing required parameters');
  }
  if (shouldOpenSrcFolder) {
    await openSrcFolder(page);
  }
  const initJsonFile = await page.waitForSelector("li#HashCoreFilesListItem-initialState > div > div > div > span > span.FileNameWithShortname__meta");
  await initJsonFile.click();
  await fakeFocusEditor(page);
  await selectContentsInTextAreaUsingKeyboard(page);
  await sleep(200);
  await page.keyboard.type(`[{\n"behaviors":["${behaviorFilenameWithExtension}"]`, { delay: 10 }); 
  await saveProjectUsingKeyboard(page);
  await sleep(1500); // give it time to save
};
const resetSimulationAndRunNSteps = async (page, steps) => {
  if (!page || !steps) {
    throw new Error('utils/resetSimulationAndRunNSteps: Missing required parameters')
  }
  const stepSimulationButton = await page.waitForSelector(
    SELECTOR_STEP_SIMULATION_BUTTON
  );
  const resetSimulationButton = await page.waitForSelector(
    SELECTOR_RESET_SIMULATION_BUTTON
  );
  await resetSimulationButton.click(); 
  await sleep(1000);
  for (let iter=0;iter<steps;iter++) {
    await stepSimulationButton.click();
    await sleep(1000);
  }
}
const closeAllSimulationViewerTabs = async (page) => {
  if (!page) {
    throw new Error('utils/closeAllSimulationViewerTabs: Missing required parameters')
  }
  await page.waitForSelector(SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS_CLOSE_BUTTON);
  const menuItems = await page.$$(SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS_CLOSE_BUTTON); 
  for (let i=0;i<menuItems.length;i++) {
    await menuItems[i].click();
  }
  await sleep(100);
}
const expectProjectTitleToMatch = async (page, projectTitleShouldMatchThis) => {
  const projectTitle = await page.waitForSelector(".HashCoreHeader-title");
  expect(await page.evaluate(el => el.innerText, projectTitle)).toBe(projectTitleShouldMatchThis);
}
const runningOnMacOs = () => process.platform === 'darwin'
const selectContentsInTextAreaUsingKeyboard = async (page) => {
  if (runningOnMacOs()) {
    await page.keyboard.down('MetaLeft');
    await page.keyboard.type('a');
    await page.keyboard.up('MetaLeft');
    return;
  }
  await page.keyboard.down('ControlLeft');
  await page.keyboard.type('a');
  await page.keyboard.up('ControlLeft');
};
const saveProjectUsingKeyboard = async (page) => {
  if (runningOnMacOs()) {
    await page.keyboard.down('MetaLeft');
    await page.keyboard.type('s');
    await page.keyboard.up('MetaLeft');
    return;
  }
  await page.keyboard.down('ControlLeft');
  await page.keyboard.type('s');
  await page.keyboard.up('ControlLeft');
} 
const deleteContentsInTextAreaUsingKeyboard = async (page) => {
  await selectContentsInTextAreaUsingKeyboard(page);
  await page.keyboard.press('Backspace');
}
const toggleEditorUsingKeyboard = async (page) => {
  await page.keyboard.down(runningOnMacOs() ? "MetaLeft" : "ControlLeft");
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.type('e');
  await page.keyboard.up(runningOnMacOs() ? "MetaLeft" : "ControlLeft");
  await page.keyboard.up("ShiftLeft");
}

module.exports.SELECTOR_STEP_SIMULATION_BUTTON = SELECTOR_STEP_SIMULATION_BUTTON;
module.exports.SELECTOR_RESET_SIMULATION_BUTTON = SELECTOR_RESET_SIMULATION_BUTTON;
module.exports.SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS = SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS;
module.exports.SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS_CLOSE_BUTTON = SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS_CLOSE_BUTTON;

module.exports.sleep = sleep;
module.exports.atLeastOneExists = atLeastOneExists;
module.exports.deleteProject = deleteProject;
module.exports.login = login;
module.exports.createNewSimulation = createNewSimulation;
module.exports.createBehavior = createBehavior;
module.exports.getFirstMatchingIdForListItem = getFirstMatchingIdForListItem;
module.exports.deleteFile = deleteFile;
module.exports.deleteBehavior = deleteBehavior;
module.exports.openSrcFolder = openSrcFolder;
module.exports.openBehaviorsFolder = openBehaviorsFolder;
module.exports.replaceInitJsonContents = replaceInitJsonContents;
module.exports.resetSimulationAndRunNSteps = resetSimulationAndRunNSteps;
module.exports.closeAllSimulationViewerTabs = closeAllSimulationViewerTabs;
module.exports.expectProjectTitleToMatch = expectProjectTitleToMatch;
module.exports.runningOnMacOs = runningOnMacOs;
module.exports.saveProjectUsingKeyboard = saveProjectUsingKeyboard;
module.exports.selectContentsInTextAreaUsingKeyboard = selectContentsInTextAreaUsingKeyboard;
module.exports.deleteContentsInTextAreaUsingKeyboard= deleteContentsInTextAreaUsingKeyboard;
module.exports.toggleEditorUsingKeyboard = toggleEditorUsingKeyboard;

module.exports.XPATH_AGENT_COUNT = "//span[contains(., 'agent_count')]"; // used in /@hash/boids-3d globals
module.exports.XPATH_EMPTY_SIMULATION_MENU_ITEM = "//a[contains(., 'Empty simulation')]"; // refers to the menu File -> New simulation -> Empty simulation
module.exports.XPATH_SIMULATION_FROM_STARTER_TEMPLATE_MENU_ITEM = "//a[contains(., 'Starter template')]"; // refers to the menu File -> New simulation -> Empty simulation

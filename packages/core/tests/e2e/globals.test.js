const {
  XPATH_AGENT_COUNT,
  SELECTOR_STEP_SIMULATION_BUTTON,
  SELECTOR_RESET_SIMULATION_BUTTON,
  SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS,
  sleep
} = require("./utils");

const WAIT_MS_AFTER_EACH_STEP = 2000;

// This test uses @hash/boids-3d as a logged out user and tests whether:
// 1. The globals pane is visible and agent_count exists
// 2. The "Raw Output" tab exists and is clickable.
// 3. The "Step Simulation" button exists and is clickable.
// 4. Running a simulation with a 1000 agents (default) generates the corresponding step data on the Raw Output tab.
// 5. It is possible to change the value of the global "agent_count"
// 6. Running a simulation with a 1 agent generates the corresponding step data on the Raw Output tab.

let agentCountLabel;
let rawOutputTab;
let stepSimulationButton;
let resetSimulationButton;
describe.only("Globals", () => {
  jest.retryTimes(3);

  beforeAll(async () => {
    await page.goto(`${HCORE_URL}/@hash/boids-3d`, {
      waitUntil: "load"
    });
    agentCountLabel = await page.waitForXPath(XPATH_AGENT_COUNT);
    stepSimulationButton = await page.waitForSelector(
      SELECTOR_STEP_SIMULATION_BUTTON
    );
    resetSimulationButton = await page.waitForSelector(
      SELECTOR_RESET_SIMULATION_BUTTON
    );

    // TODO: see if there is a shorter way to do this.
    const allListItems = await page.$$(
      SELECTOR_ALL_REACT_TAB_SELECT_LIST_ITEMS
    );
    for (let i = 0; i < allListItems.length; i++) {
      const listItem = allListItems[i];
      const valueHandle = await listItem.getProperty("innerText");
      const listItemText = await valueHandle.jsonValue();
      if (listItemText.includes("Raw Output")) {
        rawOutputTab = listItem;
      }
    }
    expect(rawOutputTab).toBeDefined();
    // Select the raw output tab by default
    await rawOutputTab.click();
  });

  test("Simulation with agent_count=1000 must match Raw Output", async () => {
    const agentCountValue = await agentCountLabel.evaluate(el =>
      el.nextSibling.childNodes[0].childNodes[0].getAttribute("value")
    );
    expect(agentCountValue).toBe("1000");
    await stepSimulationButton.click();
    await sleep(WAIT_MS_AFTER_EACH_STEP); // let the simulation run
    const content = await page.evaluate(() => {
      const state = window.simulatorStore.getState();
      const currentSim = state.simulator.currentSimulation;
      return state.simulator.simulationData[currentSim];
    });
    const stepData = content.steps["1"][0];
    expect(stepData).toBeDefined();
    expect(stepData.messages.length).toBeGreaterThan(1);
    expect(stepData.messages.length).toBeLessThanOrEqual(1001);
  });

  test("Simulation with agent_count=1 must match Raw Output", async () => {
    const STEPS_TO_RUN = 3;
    // clicking on the agent_count label will focus the input 🧠
    agentCountLabel.click();
    for (let i=0;i<4;i++) {
      await page.keyboard.press("Backspace", { delay: 150 });
    }
    await page.keyboard.press("Tab", { delay: 150 });
    await sleep(WAIT_MS_AFTER_EACH_STEP); // let the redux store update
    await resetSimulationButton.click();
    await sleep(WAIT_MS_AFTER_EACH_STEP); // let the simulation reset
    for (let i=0;i<STEPS_TO_RUN;i++) {
      await stepSimulationButton.click();
      await sleep(WAIT_MS_AFTER_EACH_STEP); // let the simulation run
    }
    const currentRun = await page.evaluate(() => {
      const state = window.simulatorStore.getState();
      const currentSim = state.simulator.currentSimulation;
      return state.simulator.simulationData[currentSim];
    });
    expect(currentRun.steps['3'].length).toBe(1);
  });
});
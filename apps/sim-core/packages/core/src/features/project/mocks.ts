import { RemoteSimulationProject, SimulationProjectWithHcFiles } from "./types";
import { toHcConfig } from "./utils";
import { toHcFiles } from "../files/utils";

export const mockRemoteProject: RemoteSimulationProject = {
  id: "",
  name: "Empty Simulation",
  description: "",
  createdAt: "",
  updatedAt: "",
  canUserEdit: false,
  pathWithNamespace: "@mock/project",
  namespace: "mock",
  type: "Simulation",
  ref: "1.0.0",
  visibility: "public",
  ownerType: "User",
  license: { id: "", name: "" },
  keywords: [],
  latestRelease: {
    tag: "1.0.0",
    createdAt: "",
  },
  files: [
    {
      name: "README.md",
      path: "README.md",
      contents: `\
This is a new simulation - it's an empty scaffold to build from.

## Create agents for the simulation:

Define initial agents in init.json by adding objects to the array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
OR convert init.json to a JavaScript or Python file by right clicking on init.json and return an array of agents
Agents will run each of their behaviors on each step of the simulation

## Add behaviors to the agents

Create new behavior files by clicking the new file indicator in the top left panel.
Select python or javascript.
Attach the behaviors to the agent by adding them to the agents behavior array
  Ex. \`\`\`[{“position”:[0,0], “behaviors”: [‘custom.js’’}]\`\`\`
Behaviors can access and modify the agent state
They can allow the agent to view other agents with neighbors: Neighbors = context.neighbors()
Or allow agents to interact by sending messages state.addMessage(...)

## Run the simulation

Click the Play button or the Step Simulation button in the bottom right under the viewer
If you’ve defined a position on the agent, you’ll see the agent appear in the 3d viewer
Click reset to reset the simulation to the initial state.
`,
      ref: "main",
    },
    {
      name: "analysis.json",
      path: "analysis.json",
      contents: `\
{
  "outputs": {},
  "plots": []
}
`,
      ref: "main",
    },
    {
      name: "dependencies.json",
      path: "dependencies.json",
      contents: "{}",
      ref: "main",
    },
    {
      name: "globals.json",
      path: "src/globals.json",
      contents:
        '{"onion":{"hasMany":{"layers":true}},"apple":"macbook","twoLevelsDeep":{"theLastLevel":true}}',
      ref: "main",
    },
    {
      name: "init.json",
      path: "src/init.json",
      contents: "[]",
      ref: "main",
    },
    {
      name: "experiments.json",
      path: "src/experiments.json",
      contents: "{}",
      ref: "main",
    },
    {
      name: "hash.json",
      path: "hash.json",
      contents: "{}",
      ref: "main",
    },
  ],
  forkOf: null,
  dependencies: [],
};

export const mockProject: SimulationProjectWithHcFiles = {
  ...mockRemoteProject,
  access: null,
  files: toHcFiles(mockRemoteProject),
  config: toHcConfig(mockRemoteProject),
  ref: "1.0.0",
};

import { CommitActionVerb } from "../../../../util/api/auto-types";
import { ProjectTemplate } from "./types";

const starterSimAnalysis = `\
{
  "outputs": {}, 
  "plots": []
}`;

const starterDescription = `\
This starter template shows how to use basic features of HASH.
It should provide direction in using common patterns and tools on the platform.
`;

const starterBehavior = `\
/**
 * Write a brief description of your behavior here.
 * 
 * This behavior will cause an agent to increase its height each step
 * until it reaches the max_height defined in globals.json
 */
const behavior = (state, context) => {
  // You can access agent properties by using state.get()
  let height = state.get("height");
  
  if (height < context.globals()["max_height"]) {
    height += 1;
  }

  // You can set agent properties using state.set()
  state.set("height", height);
};`;

const starterSimDependencies = `\
{
  "@hash/create-agents/create_agents.js": "2.1.1",
  "@hash/create-scatters/create_scatters.js": "3.1.1",
  "@hash/random-movement/random_movement.rs": "1.0.0",
  "@hash/remove-self/remove_self.js": "2.1.0"
}`;

const starterSimGlobals = `\
{
  "topology": {
    "x_bounds": [0, 10],
    "y_bounds": [0, 10]
  },
  "max_height": 10
}`;

const starterSimInitialState = `\
[
  {
    "position": [0, 0],
    "color": "blue",
    "height": 1,
    "behaviors": ["new_behavior.js"]
  },
  {
    "name": "creator",
    "behaviors": [
      "@hash/create-scatters/create_scatters.js",
      "@hash/create-agents/create_agents.js",
      "@hash/remove-self/remove_self.js"
    ],
    "scatter_templates": [
      {
        "template_name": "randomly_moving",
        "template_count": 10,
        "color": "green",
        "height": 1,
        "behaviors": ["@hash/random-movement/random_movement.rs"]
      }
    ]
  }
]`;

export const starterTemplate: ProjectTemplate = [
  {
    action: CommitActionVerb.Create,
    filePath: "README.md",
    content: starterDescription,
  },
  {
    action: CommitActionVerb.Create,
    filePath: "experiments.json",
    content: "{}",
  },
  {
    action: CommitActionVerb.Create,
    filePath: "dependencies.json",
    content: starterSimDependencies,
  },
  {
    action: CommitActionVerb.Create,
    filePath: "views/analysis.json",
    content: starterSimAnalysis,
  },
  {
    action: CommitActionVerb.Create,
    filePath: "src/globals.json",
    content: starterSimGlobals,
  },
  {
    action: CommitActionVerb.Create,
    filePath: "src/init.json",
    content: starterSimInitialState,
  },
  {
    action: CommitActionVerb.Create,
    filePath: "src/behaviors/new_behavior.js",
    content: starterBehavior,
  },
];

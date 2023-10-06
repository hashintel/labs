/*
The simulations are stored in the 'example_simulations' folder.
We'll need a tool that converts them into json blobs, suitable for opening in the frontend.
For the moment, it can be a one-off and the blobs can be pasted here.
Ideally, they'll either
  a) live in github and get pulled in from there.  This file can then be reduced to only holding their metadata.
  b) less ideally, be built by webpack and placed in a file that can be loaded up here.

  For now, here's wildfires.
*/

import {
  RemoteSimulationProject,
  SimulationProjectWithHcFiles,
} from "../features/project/types";
import { toHcConfig } from "../features/project/utils";
import { toHcFiles } from "../features/files/utils";

const remoteSimulationProjects: RemoteSimulationProject[] = [
  {
    id: "@hash/wildfires-regrowth",
    name: "Wildfires - Regrowth",
    description:
      "This model simulates the spread of wildfires in a regrowing forest.",
    image: null,
    thumbnail:
      "https://s3.amazonaws.com/images.hash.ai/projects/projects/hash/wildfires-regrowth/1604676092745-thumb.png",
    createdAt: "2019-12-02T15:55:46.405Z",
    updatedAt: "2022-05-19T13:57:26.000Z",
    canUserEdit: true,
    pathWithNamespace: "@hash/wildfires-regrowth",
    namespace: "hash",
    type: "Simulation",
    ref: "main",
    visibility: "public",
    ownerType: "Org",
    forkOf: null,
    license: {
      id: "5dc3da73cc0cf804dcc66a51",
      name: "MIT License",
    },
    keywords: [
      "forest",
      "fire",
      "fractal",
      "collapse",
      "climate & environment",
      "examples",
    ],
    files: [
      {
        name: "README.md",
        path: "README.md",
        contents:
          "This model simulates the spread of wildfires in a regrowing forest.\n\nAll trees grow over time, and have a small chance of being struck by lightning. If a tree is struck by lightning, or is adjacent to a fire, it sets alight. After burning for one step, the tree is reduced to an 'ember'.\n\nEmbers have a small chance of regrowing into a new tree each step, and that chance increases linearly with the count of its adjacent trees.\n\n# Analysis\n\nIn this model, we can play with the effects of changing forest density, regrowth rate, and lighting probability in order to observe the health of our 'regrowing' forest.\n\nConsider what metrics we might evaluate to determine the health of our forest:\nAverage tree height and the number of trees in our forest exhibit periodic fluctuations. We could assess the frequency of these fluctuations or their amplitude.\n\nIf we define a \"wildfire\" as a step in the model during which there are more than a certain critical percentage of trees on fire, we can assess the frequency with which they occur. Is it periodic, or does the time between them increase?\n\n## Optimization\nLet's find out what the optimal parameters are for our forest. We'll define the healthiest forest as the one with the most trees and/or trees living the longest. We can use the `sum_age` metric as a proxy for this, since it will capture both forests with lots of trees, and forests with very old trees.\n\nIf we use `sum_age` in an Optimization experiment, we might have an experiment that looks like **Optimal Rates for Forest Growth**. This optimization varies the `lightningChance` and `regrowthChance` globals to find optimal values for both of those. If we run the experiment, our result will show that we want to minimize both values.\n\nReducing the number of lightning strikes is a fairly intuitive way to increase the health of our forest, but why should we be minimizing the chance of regrowth? Well, if you observe the **Agents by behaviors** plot, you'll see that our optimal case produces very little of the wild oscillation that is found in the base set of parameters for the model. When trees become overcrowded, fires are much easier to spread, causing much more devastation, leading to the oscillating behavior. Reducing the regrowth ensures that trees lead long and healthy lives. \n\nSee also the unbounded [Forest](https://hash.ai/index/5e065650196c3fbd41d8bd43/forest) model.\n\n```video\nhttps://cdn-us1.hash.ai/site/forest-regrowth-poly.mp4\n```",
        ref: "9.9.0",
      },
      {
        name: "dependencies.json",
        path: "dependencies.json",
        contents: '{\n  "@hash/age/age.rs": "1.0.0"\n}',
        ref: "9.9.0",
      },
      {
        name: "experiments.json",
        path: "experiments.json",
        contents:
          '{\n  "Optimal Rates for Forest Growth": {\n    "type": "optimization",\n    "maxRuns": 20,\n    "minSteps": 400,\n    "maxSteps": 500,\n    "metricName": "sum_age",\n    "metricObjective": "max",\n    "fields": [\n      {"name": "regrowthChance", "range": "0.0001-0.01"},\n      {"name": "lightningChance", "range": "0.0001-0.01"}\n    ]\n  },\n  "Test Experiment": {\n    "type": "values",\n    "steps": 100,\n    "field": "lightningChance",\n    "values": [0.1, 0.01, 0.001]\n  },\n  "lightningChanceLinSpace": {\n    "steps": 100,\n    "type": "linspace",\n    "field": "lightningChance",\n    "start": 0.001,\n    "stop": 0.1,\n    "samples": 5\n  }\n}',
        ref: "9.9.0",
      },
      {
        name: "hash.json",
        path: "hash.json",
        contents:
          '{\n  "keywords": [\n    "forest",\n    "fire",\n    "fractal",\n    "collapse",\n    "climate & environment",\n    "examples"\n  ],\n  "subject": [],\n  "license": "5dc3da73cc0cf804dcc66a51",\n  "type": "Simulation",\n  "avatar": "https://s3.amazonaws.com/images.hash.ai/projects/hash/wildfires-regrowth/1604676084572-avatar.mp4",\n  "thumbnail": "https://s3.amazonaws.com/images.hash.ai/projects/projects/hash/wildfires-regrowth/1604676092745-thumb.png",\n  "files": []\n}',
        ref: "9.9.0",
      },
      {
        name: "ember.js",
        path: "src/behaviors/ember.js",
        contents:
          '/**\n * This behavior causes the agent to change from an ember\n * back to a growing tree.\n */\nfunction behavior(state, context) {\n  const { emberColor, emberHeight, regrowthChance } = context.globals();\n  \n  // Get neighbors that are "trees"\n  const forestNeighbors = context.neighbors()\n    .filter(({behaviors}) => behaviors.includes("forest.js"));\n\n  // Turn back into a tree, with a linear increase\n  // in likelihood with # of neighbors\n  const modRegrowthChance = regrowthChance * (forestNeighbors.length + 1);\n  if (modRegrowthChance > Math.random()) {\n    // Replace the ember behavior with forest behavior\n    state.behaviors[state.behaviorIndex()] = "forest.js";\n  }\n\n  // Set other needed properties for an "ember"\n  state.color = emberColor;\n  state.height = emberHeight;\n  state.age = 0;\n};\n',
        ref: "9.9.0",
      },
      {
        name: "ember.js.json",
        path: "src/behaviors/ember.js.json",
        contents:
          '{\n\t"keys": {\n\t\t"age": {\n\t\t\t"type": "number",\n\t\t\t"nullable": true\n\t\t}\n\t},\n\t"built_in_key_use": null\n}',
        ref: "9.9.0",
      },
      {
        name: "fire.js",
        path: "src/behaviors/fire.js",
        contents:
          '/**\n * This behavior causes the tree agent to "catch fire",\n * turn red, and then "burn down" into an ember.\n */\nfunction behavior(state, context) {\n\n  // Replace the fire behavior with the ember behavior\n  state.behaviors[state.behaviorIndex()] = "ember.js";\n\n  state.color = context.globals().fireColor;\n  state.shape = "fire";\n  state.height = 3;\n};\n',
        ref: "9.9.0",
      },
      {
        name: "fire.js.json",
        path: "src/behaviors/fire.js.json",
        contents: '{\n\t"keys": {},\n\t"built_in_key_use": null\n}',
        ref: "9.9.0",
      },
      {
        name: "forest.js",
        path: "src/behaviors/forest.js",
        contents:
          '/**\n * This behavior causes a tree to catch fire from its\n * neighbors or from a random lightning strike.\n */\nfunction behavior(state, context) {\n  const { lightningChance, lightningColor, \n    forestColor, forestHeight } = context.globals();\n\n  // Grow the trees\' height logarithmically with age\n  state.height = Math.max(2, 2 + Math.log2((forestHeight * state.age) / 10));\n\n\n  // Get neighbors that are on fire\n  const fireNeighbors = context.neighbors()\n    .filter(({behaviors}) => behaviors.includes("fire.js")).length;\n  \n  // Tres can be struck by lightning randomly\n  const struckByLightning = lightningChance > Math.random();\n\n  // If there is an adjacent fire or lightning strike\n  // then this tree starts to burn (becomes fire)\n  if (struckByLightning || fireNeighbors > 0) {\n    // Replace forest behavior with fire\n    state.behaviors[state.behaviorIndex()] = "fire.js";\n  }\n\n  // Color the agent appropriately\n  if (struckByLightning) {\n    state.color = lightningColor;\n  } else {\n    state.color = forestColor;\n    state.shape = "xmas-tree";\n  }\n};\n',
        ref: "9.9.0",
      },
      {
        name: "forest.js.json",
        path: "src/behaviors/forest.js.json",
        contents:
          '{\n\t"keys": {\n\t\t"age": {\n\t\t\t"type": "number",\n\t\t\t"nullable": true\n\t\t}\n\t},\n\t"built_in_key_use": null\n}',
        ref: "9.9.0",
      },
      {
        name: "globals.json",
        path: "src/globals.json",
        contents:
          '{\n  "lightningChance": 0.001,\n  "regrowthChance": 0.001,\n  "forestColor": "green",\n  "fireColor": "red",\n  "emberColor": "yellow",\n  "lightningColor": "silver",\n  "forestHeight": 10,\n  "emberHeight": 0,\n  "wildfire_count": 20,\n  "topology": {\n    "x_bounds": [-20, 20],\n    "y_bounds": [-20, 20],\n    "search_radius": 1\n  }\n}',
        ref: "9.9.0",
      },
      {
        name: "init.js",
        path: "src/init.js",
        contents:
          '/**\n * @param {InitContext} context for initialization\n */\nconst init = (context) => {\n\n  const gen_tree = () => ({\n    "behaviors": [\n      "forest.js",\n      "@hash/age/age.rs"\n    ],\n    "color": "green",\n    "shape": "xmas-tree",\n    "scale": [2, 2],\n    "height": 1\n  });\n\n  return hstd.init.grid(context.globals().topology, gen_tree);\n}\n',
        ref: "9.9.0",
      },
      {
        name: "analysis.json",
        path: "views/analysis.json",
        contents:
          '{\n  "outputs": {\n    "trees": [\n      {"op": "filter", "field": "color", "comparison": "eq", "value": "green"},\n      {"op": "count"}\n    ],\n    "fires": [\n      {"op": "filter", "field": "color", "comparison": "eq", "value": "red"},\n      {"op": "count"}\n    ],\n    "embers": [\n      {"op": "filter", "field": "color", "comparison": "eq", "value": "yellow"},\n      {"op": "count"}\n    ],\n    "forest_fire": [\n      {"op": "filter", "field": "color", "comparison": "eq", "value": "red"},\n      {"op": "count"}\n    ],\n    "age": [\n      {"op": "filter", "field": "color", "comparison": "eq", "value": "green"},\n      {"op": "get", "field": "age"},\n      {"op": "mean"}\n    ],\n    "sum_age": [\n      {"op": "filter", "field": "color", "comparison": "eq", "value": "green"},\n      {"op": "get", "field": "age"},\n      {"op": "sum"}\n    ]\n  },\n  "plots": [\n    {\n      "title": "Agents by behaviors",\n      "timeseries": ["trees", "fires", "embers"],\n      "layout": {"width": "100%", "height": "60%"},\n      "position": {"x": "0%", "y": "0%"}\n    },\n    {\n      "title": "Average age",\n      "timeseries": ["age"],\n      "layout": {"width": "100%", "height": "60%"},\n      "position": {"x": "0%", "y": "60%"}\n    },\n    {\n      "title": "Wildfire Occurrences",\n      "timeseries": ["forest_fire"],\n      "layout": {"width": "100%", "height": "60%"},\n      "position": {"x": "0%", "y": "120%"}\n    },\n    {\n      "title": "Age Distribution",\n      "type": "box",\n      "data": [{"y": "Age", "name": "Age"}],\n      "layout": {"width": "100%", "height": "50%"},\n      "position": {"x": "0%", "y": "180%"}\n    },\n    {\n      "title": "Correlation Between Trees and Fires",\n      "type": "scatter",\n      "data": [{"y": "fires", "x": "trees"}],\n      "layout": {"width": "100%", "height": "50%"},\n      "position": {"x": "0%", "y": "230%"}\n    }\n  ]\n}',
        ref: "9.9.0",
      },
    ],
    dependencies: [
      {
        pathWithNamespace: "@hash/age",
        tag: "1.0.0",
        latestReleaseTag: "1.0.0",
        canUserEdit: false,
        visibility: "public",
        files: [
          {
            name: "age.rs",
            path: "src/behaviors/age.rs",
            dependencyPath: "@hash/age/age.rs",
            contents:
              'use crate::prelude::{AgentState, Context, SimulationResult};\n\npub fn age(mut state: AgentState, _context: &Context) -> SimulationResult<AgentState> {\n    let age = match state["age"].as_i64() {\n        Some(age) => age + 1,\n        None => 1,\n    };\n\n    state["age"] = json!(age);\n\n    Ok(state)\n}\n',
            ref: "1.0.0",
          },
          {
            name: "age.rs.json",
            path: "src/behaviors/age.rs.json",
            dependencyPath: "@hash/age/age.rs.json",
            contents:
              '{\n    "keys": {\n        "age": {\n            "type": "number",\n            "nullable": true\n        }\n    },\n    "built_in_key_use": {"selected": []}\n}\n',
            ref: "1.0.0",
          },
        ],
      },
    ],
  },
];

export const BUILTIN_SIMULATIONS: SimulationProjectWithHcFiles[] = remoteSimulationProjects.map(
  (project) => ({
    ...project,
    config: toHcConfig(project),
    files: toHcFiles(project),
    ref: project.ref ?? "main",
    access: null,
  })
);

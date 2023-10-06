import { JSONSchema7 } from "json-schema";

import { BUILTIN_MODELS } from "../../../components/AgentScene/util/builtinmodels";

export const initSchema: JSONSchema7 = {
  type: "array",
  items: {
    properties: {
      agent_id: { type: "string" },
      behaviors: {
        type: "array",
        items: { type: "string" },
      },
      color: {
        anyOf: [
          { type: "string" },
          { type: "array", minItems: 3, maxItems: 3 },
        ],
      },
      height: { type: "number" },
      position: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 3,
      },
      rgb: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "number" },
      },
      scale: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "number" },
      },
      shape: {
        type: "string",
        enum: [
          "box",
          "cone",
          "cylinder",
          "dodecahedron",
          "flatplane",
          "icosahedron",
          "octahedron",
          "sphere",
          "tetrahedron",
          "torus",
          "torusknot",
          ...Object.keys(BUILTIN_MODELS),
        ],
      },
    },
  },
};

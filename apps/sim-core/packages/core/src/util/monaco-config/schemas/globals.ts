import { JSONSchema7 } from "json-schema";

export const globalConfigSchema: JSONSchema7 = {
  type: "object",
  properties: {
    topology: {
      type: "object",
      properties: {
        x_bounds: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
        },
        y_bounds: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
        },
        z_bounds: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
        },
        search_radius: {
          type: "number",
        },
        wrap_x_mode: {
          type: "string",
          enum: ["continuous", "reflection", "offset_reflection", "no_wrap"],
        },
        wrap_y_mode: {
          type: "string",
          enum: ["continuous", "reflection", "offset_reflection", "no_wrap"],
        },
        wrap_z_mode: {
          type: "string",
          enum: ["continuous", "reflection", "offset_reflection", "no_wrap"],
        },
        wrapping_preset: {
          type: "string",
          enum: ["spherical", "reflection", "torus", "continuous"],
        },
        distance_function: {
          type: "string",
          enum: [
            "chebyshev",
            "conway" /*> RIP :'( */,
            "manhattan",
            "euclidean",
            "euclidean_squared",
          ],
        },
      },
    },
  },
};

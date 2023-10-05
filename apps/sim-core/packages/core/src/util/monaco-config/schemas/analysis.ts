export const analysisSchema = {
  type: "object",
  properties: {
    outputs: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: {
                op: {
                  type: "string",
                  enum: ["count", "sum", "min", "max", "mean"],
                },
              },
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                op: {
                  type: "string",
                  enum: ["get"],
                },
                field: {
                  type: "string",
                },
              },
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                op: {
                  const: "filter",
                },
                field: {
                  type: "string",
                },
                comparison: {
                  type: "string",
                  enum: ["eq", "neq", "lt", "lte", "gt", "gte"],
                },
                value: {
                  oneOf: [
                    { type: "number" },
                    { type: "string" },
                    { type: "boolean" },
                    { type: "null" },
                  ],
                },
                additionalProperties: false,
              },
            },
          ],
        },
      },
    },
    plots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          timeseries: { type: "array", items: { type: "string" } },
          scatter: { type: "array", items: { type: "string" } },
          scatter3d: { type: "array", items: { type: "string" } },
          layout: { type: "object" },
          config: { type: "object" },
          position: {
            type: "object",
            properties: {
              x: {
                oneOf: [{ type: "number" }, { type: "string" }],
              },
              y: {
                oneOf: [{ type: "number" }, { type: "string" }],
              },
            },
          },
          type: {
            type: "string",
            enum: [
              "histogram",
              "bar",
              "area",
              "box",
              "line",
              "scatter",
              "scatter3d",
              "area3d",
            ],
          },
          data: { type: "array", items: { type: "object" } },
          hideStep: { type: "boolean" },
        },
      },
    },
  },
};

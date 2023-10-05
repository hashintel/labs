import { languages } from "monaco-editor";

import { analysisSchema } from "./schemas/analysis";
import { globalConfigSchema } from "./schemas/globals";
import { initSchema } from "./schemas/init";

const toDataURI = (data: any) =>
  `"data:text/json;base64,${btoa(JSON.stringify(data, null, "\t"))}"`;

export const configSchemas = () =>
  languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [
      {
        uri: toDataURI(initSchema),
        fileMatch: ["file:///init.json*"],
        schema: initSchema,
      },
      {
        uri: toDataURI(globalConfigSchema),
        fileMatch: ["file:///globals.json*"],
        schema: globalConfigSchema,
      },
      {
        uri: toDataURI(analysisSchema),
        fileMatch: ["file:///analysis.json*"],
        schema: analysisSchema,
      },
    ],
  });

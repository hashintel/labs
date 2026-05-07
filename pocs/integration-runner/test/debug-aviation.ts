import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { resolveEnvVars } from "../src/schema.js";
import { buildPipelines } from "../src/build.js";
import type { Step } from "@integrations/transform/pipeline.js";

process.env.HASH_WEB_ID ??= "test-web";
const yaml = resolveEnvVars(parse(readFileSync("test/aviation.yaml", "utf8")));
const pipelines = buildPipelines(yaml);

function dumpSteps(steps: readonly Step[], indent = "") {
  for (const s of steps) {
    console.log(`${indent}${s.kind} "${s.id}"`);
    if (s.kind === "branch") {
      for (let i = 0; i < s.branches.length; i++) {
        console.log(`${indent}  branch[${i}]:`);
        dumpSteps(s.branches[i] as Step[], indent + "    ");
      }
    }
    if (s.kind === "graph-sink") {
      console.log(`${indent}  entityType=${s.config.entityType.split("/").slice(-2).join("/")}`);
      console.log(`${indent}  props=${Object.keys(s.config.properties).length} links=${s.config.links?.length ?? 0}`);
    }
  }
}

for (const tp of pipelines) {
  console.log(`\npipeline source="${tp.source}" pipe.source="${tp.pipeline.source}"`);
  dumpSteps(tp.pipeline.steps);
}

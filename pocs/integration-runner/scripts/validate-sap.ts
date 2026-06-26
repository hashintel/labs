import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { resolveEnvVars } from "../src/schema.js";
import { validateYaml } from "../src/validate.js";
import { buildConnectorDef, buildPipelines, buildLinkPipelines } from "../src/build.js";
import { integrate } from "@integrations/engine.js";
import { createStubGraphClient } from "@integrations/graph/stub.js";
const path = process.argv[2];
const env = { ...process.env, SOURCE_FOLDER: "./data", HASH_WEB_ID: "web", HASH_TYPE_BASE: "https://hash.ai/@h/types" };
const yaml = resolveEnvVars(parseYaml(readFileSync(path, "utf8")), env);
const errors = validateYaml(yaml);
if (errors.length) { for (const e of errors) console.error(`  ${e.path}: ${e.message}`); process.exit(1); }
const spec = { connector: buildConnectorDef(yaml), pipelines: buildPipelines(yaml), linkPipelines: buildLinkPipelines(yaml), graphClient: createStubGraphClient() } as Parameters<typeof integrate>[0];
integrate(spec);
console.log(`[validate] OK: ${spec.pipelines.length} pipelines, ${spec.linkPipelines.length} links`);

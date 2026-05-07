import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IntegrationYaml } from "./schema.js";

export type IntegrationId = {
  webId: string;
  connectorId: string;
  canonical: string;
  configHash: string;
};

export function integrationId(yaml: IntegrationYaml, webId: string): IntegrationId {
  const connectorId = yaml.connector.id;
  return {
    webId,
    connectorId,
    canonical: `${webId}:${connectorId}`,
    configHash: createHash("sha256").update(JSON.stringify(yaml)).digest("hex").slice(0, 12),
  };
}

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function statePaths(baseDir: string, id: IntegrationId) {
  const root = ensureDir(join(baseDir, "state", id.webId, id.connectorId));
  return {
    duckdb: join(root, "store.duckdb"),
    staging: ensureDir(join(root, "staging")),
  };
}

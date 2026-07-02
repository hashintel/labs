import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateYaml } from "./validate.js";
import type { IntegrationYaml } from "./schema.js";

const base = (): IntegrationYaml => ({
  connector: { id: "crm", mode: "batch" },
  sources: {
    users: { kind: "sql", sql: "SELECT 1 AS id", primaryKey: "id" },
    orgs: { kind: "sql", sql: "SELECT 1 AS id", primaryKey: "id" },
  },
  pipelines: {
    entities: [
      { source: "users", steps: [{ id: "cp-users", kind: "checkpoint", name: "users" }] },
      { source: "orgs", steps: [{ id: "cp-orgs", kind: "checkpoint", name: "orgs" }] },
    ],
  },
});

describe("validateYaml link pipelines", () => {
  it("accepts multi-input checkpoint links", () => {
    const yaml = base();
    yaml.pipelines.links = [{
      id: "users-orgs",
      inputs: { users: "users", orgs: "orgs" },
      steps: [{ kind: "sql", id: "join", sql: "SELECT users.id AS source_id, orgs.id AS target_id FROM users JOIN orgs ON true" }],
      from: { entityType: "user", column: "source_id" },
      to: { entityType: "org", column: "target_id" },
      linkType: "member-of",
    }];
    assert.deepEqual(validateYaml(yaml), []);
  });

  it("rejects missing checkpoint inputs", () => {
    const yaml = base();
    yaml.pipelines.links = [{
      id: "users-orgs",
      inputs: { users: "missing" },
      from: { entityType: "user", column: "source_id" },
      to: { entityType: "org", column: "target_id" },
      linkType: "member-of",
    }];
    assert.match(validateYaml(yaml)[0].message, /checkpoint "missing"/);
  });

  it("rejects source plus inputs", () => {
    const yaml = base();
    yaml.pipelines.links = [{
      id: "users-orgs",
      source: "users",
      inputs: { orgs: "orgs" },
      from: { entityType: "user", column: "source_id" },
      to: { entityType: "org", column: "target_id" },
      linkType: "member-of",
    }];
    assert.equal(validateYaml(yaml)[0].message, "use either source or inputs, not both");
  });

  it("requires sql for multi-input links", () => {
    const yaml = base();
    yaml.pipelines.links = [{
      id: "users-orgs",
      inputs: { users: "users", orgs: "orgs" },
      from: { entityType: "user", column: "source_id" },
      to: { entityType: "org", column: "target_id" },
      linkType: "member-of",
    }];
    assert.equal(validateYaml(yaml)[0].message, "multi-input link pipelines require at least one sql step");
  });

  it("reserves the input alias for rolling step input", () => {
    const yaml = base();
    yaml.pipelines.links = [{
      id: "users-orgs",
      inputs: { input: "users", orgs: "orgs" },
      steps: [{ kind: "sql", id: "join", sql: "SELECT input.id AS source_id, orgs.id AS target_id FROM input JOIN orgs ON true" }],
      from: { entityType: "user", column: "source_id" },
      to: { entityType: "org", column: "target_id" },
      linkType: "member-of",
    }];
    assert.equal(validateYaml(yaml)[0].message, "input alias \"input\" is reserved for the rolling step input");
  });
});

describe("validateYaml entity pipeline inputs", () => {
  it("accepts checkpoint inputs produced by another entity pipeline", () => {
    const yaml = base();
    yaml.pipelines.entities[0].inputs = { orgs: "orgs" };
    assert.deepEqual(validateYaml(yaml), []);
  });

  it("rejects missing checkpoint inputs", () => {
    const yaml = base();
    yaml.pipelines.entities[0].inputs = { orgs: "missing" };
    assert.match(validateYaml(yaml)[0].message, /checkpoint "missing"/);
  });

  it("rejects self checkpoint inputs", () => {
    const yaml = base();
    yaml.pipelines.entities[0].inputs = { users: "users" };
    assert.match(validateYaml(yaml)[0].message, /same entity pipeline/);
  });

  it("reserves the input alias for rolling step input", () => {
    const yaml = base();
    yaml.pipelines.entities[0].inputs = { input: "orgs" };
    assert.equal(validateYaml(yaml)[0].message, "input alias \"input\" is reserved for the rolling step input");
  });
});

describe("validateYaml source asserts", () => {
  const withAsserts = (asserts: unknown): IntegrationYaml => {
    const yaml = base();
    (yaml.sources!.users as { asserts?: unknown }).asserts = asserts;
    return yaml;
  };

  it("accepts a full valid asserts block", () => {
    assert.deepEqual(validateYaml(withAsserts({
      rowCount: { min: 1, max: 100 },
      notNull: ["id"],
      unique: ["id", ["id", "plant"]],
    })), []);
  });

  it("rejects unknown assert keys", () => {
    const errors = validateYaml(withAsserts({ rowcount: { min: 1 } }));
    assert.equal(errors[0].path, "sources.users.asserts.rowcount");
    assert.match(errors[0].message, /unknown assert/);
  });

  it("rejects non-numeric rowCount bounds", () => {
    const errors = validateYaml(withAsserts({ rowCount: { min: "1" } }));
    assert.equal(errors[0].path, "sources.users.asserts.rowCount.min");
  });

  it("rejects non-string notNull entries", () => {
    const errors = validateYaml(withAsserts({ notNull: [1] }));
    assert.equal(errors[0].path, "sources.users.asserts.notNull");
  });

  it("rejects malformed unique keys", () => {
    const errors = validateYaml(withAsserts({ unique: [[]] }));
    assert.equal(errors[0].path, "sources.users.asserts.unique");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortPipelines, TopologyError } from "./topology.js";
import {
  pipe,
  sqlStep,
  graphSinkStep,
  branch,
  namespace,
  type TablePipeline,
} from "./pipeline.js";

const T = namespace("https://hash.ai/@test/types");

function orgPipeline() {
  return pipe(
    "src/orgs",
    sqlStep({ id: "org-norm", query: "SELECT _op, _key, id AS orgId FROM input" }),
    graphSinkStep({
      id: "write-orgs",
      entityType: T.entity("organization/v/1"),
      entityId: "orgId",
      webId: "w",
      properties: {},
    }),
  );
}

function userPipeline() {
  return pipe(
    "src/users",
    sqlStep({ id: "user-enrich", query: "SELECT _op, _key, id AS userId, org_id AS orgId FROM input" }),
    graphSinkStep({
      id: "write-users",
      entityType: T.entity("user/v/1"),
      entityId: "userId",
      webId: "w",
      properties: {},
      links: [{ column: "orgId", linkType: T.link("is-member-of/v/1"), targetEntityType: T.entity("organization/v/1") }],
    }),
  );
}

describe("sortPipelines", () => {
  it("preserves declared order when no dependencies", () => {
    const pipelines: TablePipeline[] = [
      { table: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })) },
      { table: "b", pipeline: pipe("src/b", sqlStep({ id: "b1", query: "SELECT _op, _key FROM input" })) },
      { table: "c", pipeline: pipe("src/c", sqlStep({ id: "c1", query: "SELECT _op, _key FROM input" })) },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.table), ["a", "b", "c"]);
  });

  it("respects dependsOn when declared order is wrong", () => {
    const pipelines: TablePipeline[] = [
      { table: "users", pipeline: userPipeline(), dependsOn: ["organizations"] },
      { table: "organizations", pipeline: orgPipeline() },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.table), ["organizations", "users"]);
  });

  it("keeps declared order when already topologically valid", () => {
    const pipelines: TablePipeline[] = [
      { table: "organizations", pipeline: orgPipeline() },
      { table: "users", pipeline: userPipeline(), dependsOn: ["organizations"] },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.table), ["organizations", "users"]);
  });

  it("throws on cyclic pipeline dependencies", () => {
    const pipelines: TablePipeline[] = [
      { table: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })), dependsOn: ["b"] },
      { table: "b", pipeline: pipe("src/b", sqlStep({ id: "b1", query: "SELECT _op, _key FROM input" })), dependsOn: ["a"] },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Cyclic"),
    );
  });

  it("throws on dangling pipeline dependsOn", () => {
    const pipelines: TablePipeline[] = [
      { table: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })), dependsOn: ["ghost"] },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes(`"ghost"`),
    );
  });

  it("throws on self-referential pipeline dependsOn", () => {
    const pipelines: TablePipeline[] = [
      { table: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })), dependsOn: ["a"] },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("itself"),
    );
  });

  it("throws on duplicate pipeline table names", () => {
    const pipelines: TablePipeline[] = [
      { table: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })) },
      { table: "a", pipeline: pipe("src/a2", sqlStep({ id: "a2", query: "SELECT _op, _key FROM input" })) },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Duplicate pipeline"),
    );
  });

  it("throws on duplicate step ids across pipelines", () => {
    const pipelines: TablePipeline[] = [
      { table: "a", pipeline: pipe("src/a", sqlStep({ id: "shared", query: "SELECT _op, _key FROM input" })) },
      { table: "b", pipeline: pipe("src/b", sqlStep({ id: "shared", query: "SELECT _op, _key FROM input" })) },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Duplicate step"),
    );
  });

  it("throws on duplicate step ids within one pipeline (including branches)", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "a",
        pipeline: pipe(
          "src/a",
          branch("b1",
            [sqlStep({ id: "dup", query: "SELECT _op, _key FROM input" })],
            [sqlStep({ id: "dup", query: "SELECT _op, _key FROM input" })],
          ),
        ),
      },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Duplicate step"),
    );
  });

  it("throws on dangling step dependsOn", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "a",
        pipeline: pipe(
          "src/a",
          sqlStep({ id: "s1", query: "SELECT _op, _key FROM input", dependsOn: ["ghost"] }),
        ),
      },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes(`"ghost"`),
    );
  });

  it("throws on self-referential step dependsOn", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "a",
        pipeline: pipe(
          "src/a",
          sqlStep({ id: "s1", query: "SELECT _op, _key FROM input", dependsOn: ["s1"] }),
        ),
      },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("itself"),
    );
  });

  it("accepts step dependsOn earlier step in same pipeline", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "a",
        pipeline: pipe(
          "src/a",
          sqlStep({ id: "s1", query: "SELECT _op, _key FROM input" }),
          sqlStep({ id: "s2", query: "SELECT _op, _key FROM input", dependsOn: ["s1"] }),
        ),
      },
    ];
    const { order } = sortPipelines(pipelines);
    assert.equal(order.length, 1);
  });

  it("throws when step dependsOn a later step in same pipeline", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "a",
        pipeline: pipe(
          "src/a",
          sqlStep({ id: "s1", query: "SELECT _op, _key FROM input", dependsOn: ["s2"] }),
          sqlStep({ id: "s2", query: "SELECT _op, _key FROM input" }),
        ),
      },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("does not run before"),
    );
  });

  it("infers pipeline dep from cross-pipeline step dependsOn", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "users",
        pipeline: pipe(
          "src/users",
          graphSinkStep({
            id: "write-users",
            entityType: T.entity("user/v/1"),
            entityId: "id",
            webId: "w",
            properties: {},
            dependsOn: ["write-orgs"],
          }),
        ),
      },
      { table: "organizations", pipeline: orgPipeline() },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.table), ["organizations", "users"]);
  });

  it("detects cycles formed through step dependsOn", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "a",
        pipeline: pipe(
          "src/a",
          sqlStep({ id: "sa", query: "SELECT _op, _key FROM input", dependsOn: ["sb"] }),
        ),
      },
      {
        table: "b",
        pipeline: pipe(
          "src/b",
          sqlStep({ id: "sb", query: "SELECT _op, _key FROM input", dependsOn: ["sa"] }),
        ),
      },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Cyclic"),
    );
  });

  it("hints when a link target's producer is not in dependsOn", () => {
    const pipelines: TablePipeline[] = [
      { table: "organizations", pipeline: orgPipeline() },
      { table: "users", pipeline: userPipeline() },
    ];
    const { hints } = sortPipelines(pipelines);
    assert.equal(hints.length, 1);
    assert.match(hints[0], /users.*organization\/v\/1.*dependsOn/);
  });

  it("no hint when link target producer is in transitive dependsOn", () => {
    const pipelines: TablePipeline[] = [
      { table: "organizations", pipeline: orgPipeline() },
      { table: "users", pipeline: userPipeline(), dependsOn: ["organizations"] },
    ];
    const { hints } = sortPipelines(pipelines);
    assert.equal(hints.length, 0);
  });

  it("hints when a link target has no producer", () => {
    const pipelines: TablePipeline[] = [
      { table: "users", pipeline: userPipeline() },
    ];
    const { hints } = sortPipelines(pipelines);
    assert.equal(hints.length, 1);
    assert.match(hints[0], /no pipeline produces/);
  });

  it("no hint when link target is produced by the same pipeline (branch)", () => {
    const pipelines: TablePipeline[] = [
      {
        table: "aviation",
        pipeline: pipe(
          "src/aviation",
          branch("fanout",
            [graphSinkStep({
              id: "write-airports",
              entityType: T.entity("airport/v/1"),
              entityId: "icao",
              webId: "w",
              properties: {},
            })],
            [graphSinkStep({
              id: "write-flights",
              entityType: T.entity("flight/v/1"),
              entityId: "id",
              webId: "w",
              properties: {},
              links: [{ column: "origin", linkType: T.link("departs-from/v/1"), targetEntityType: T.entity("airport/v/1") }],
            })],
          ),
        ),
      },
    ];
    const { hints } = sortPipelines(pipelines);
    assert.equal(hints.length, 0);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortPipelines, TopologyError } from "./topology.js";
import {
  pipe,
  sqlStep,
  graphSinkStep,
  branch,
  checkpoint,
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
    }),
  );
}

describe("sortPipelines", () => {
  it("preserves declared order when no dependencies", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })) },
      { source: "b", pipeline: pipe("src/b", sqlStep({ id: "b1", query: "SELECT _op, _key FROM input" })) },
      { source: "c", pipeline: pipe("src/c", sqlStep({ id: "c1", query: "SELECT _op, _key FROM input" })) },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.source), ["a", "b", "c"]);
  });

  it("respects dependsOn when declared order is wrong", () => {
    const pipelines: TablePipeline[] = [
      { source: "users", pipeline: userPipeline(), dependsOn: ["organizations"] },
      { source: "organizations", pipeline: orgPipeline() },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.source), ["organizations", "users"]);
  });

  it("keeps declared order when already topologically valid", () => {
    const pipelines: TablePipeline[] = [
      { source: "organizations", pipeline: orgPipeline() },
      { source: "users", pipeline: userPipeline(), dependsOn: ["organizations"] },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.source), ["organizations", "users"]);
  });

  it("throws on cyclic pipeline dependencies", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })), dependsOn: ["b"] },
      { source: "b", pipeline: pipe("src/b", sqlStep({ id: "b1", query: "SELECT _op, _key FROM input" })), dependsOn: ["a"] },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Cyclic"),
    );
  });

  it("throws on dangling pipeline dependsOn", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })), dependsOn: ["ghost"] },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes(`"ghost"`),
    );
  });

  it("throws on self-referential pipeline dependsOn", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })), dependsOn: ["a"] },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("itself"),
    );
  });

  it("throws on duplicate pipeline source names", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", sqlStep({ id: "a1", query: "SELECT _op, _key FROM input" })) },
      { source: "a", pipeline: pipe("src/a2", sqlStep({ id: "a2", query: "SELECT _op, _key FROM input" })) },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Duplicate pipeline"),
    );
  });

  it("throws on duplicate step ids across pipelines", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", sqlStep({ id: "shared", query: "SELECT _op, _key FROM input" })) },
      { source: "b", pipeline: pipe("src/b", sqlStep({ id: "shared", query: "SELECT _op, _key FROM input" })) },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("Duplicate step"),
    );
  });

  it("throws on duplicate checkpoint names across pipelines", () => {
    const pipelines: TablePipeline[] = [
      { source: "a", pipeline: pipe("src/a", checkpoint({ id: "cp-a", name: "shared" })) },
      { source: "b", pipeline: pipe("src/b", checkpoint({ id: "cp-b", name: "shared" })) },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes(`Duplicate checkpoint name "shared"`),
    );
  });

  it("throws on duplicate step ids within one pipeline (including branches)", () => {
    const pipelines: TablePipeline[] = [
      {
        source: "a",
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
        source: "a",
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
        source: "a",
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
        source: "a",
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
        source: "a",
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
        source: "users",
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
      { source: "organizations", pipeline: orgPipeline() },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.source), ["organizations", "users"]);
  });

  it("detects cycles formed through step dependsOn", () => {
    const pipelines: TablePipeline[] = [
      {
        source: "a",
        pipeline: pipe(
          "src/a",
          sqlStep({ id: "sa", query: "SELECT _op, _key FROM input", dependsOn: ["sb"] }),
        ),
      },
      {
        source: "b",
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

  it("orders an inputs-checkpoint producer before its consumer", () => {
    const producer = pipe(
      "src/organizations",
      sqlStep({ id: "o1", query: "SELECT _op, _key, id AS orgId FROM input" }),
      checkpoint({ id: "cp-orgs", name: "cp/orgs" }),
    );
    const pipelines: TablePipeline[] = [
      { source: "users", pipeline: userPipeline(), inputs: { orgs: "cp/orgs" } },
      { source: "organizations", pipeline: producer },
    ];
    const { order } = sortPipelines(pipelines);
    assert.deepEqual(order.map((p) => p.source), ["organizations", "users"]);
  });

  it("throws when inputs reference an unproduced checkpoint", () => {
    const pipelines: TablePipeline[] = [
      { source: "users", pipeline: userPipeline(), inputs: { orgs: "cp/missing" } },
    ];
    assert.throws(() => sortPipelines(pipelines), (err: Error) =>
      err instanceof TopologyError && err.message.includes("no pipeline produces it"),
    );
  });

});

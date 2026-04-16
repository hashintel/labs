import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { META_COLUMNS, type QueryableStore } from "../staging/types.js";
import { pipe, pipelines, sqlStep, fnStep, branch, graphSinkStep, namespace, type Row, type Envelope, type SchemaDecl, type SideEffectHandler } from "./pipeline.js";
import { runPipeline, validatePipeline } from "./run.js";

let db: QueryableStore;

afterEach(() => db?.close());

async function seedUsers(db: QueryableStore) {
  await db.materialize("test", "users", [
    { table: "users", op: "insert" as const, key: { id: 1 }, row: { id: "1", email: "alice@example.com", first_name: "Alice", last_name: "Smith" } },
    { table: "users", op: "update" as const, key: { id: 2 }, row: { id: "2", email: "bob@example.com", first_name: "Bob", last_name: "Jones" } },
    { table: "users", op: "delete" as const, key: { id: 3 }, row: null },
  ]);
}

describe("pipe + runPipeline", () => {
  it("SELECT * carries _op/_key through", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "pass", query: `SELECT * FROM input` }),
    ), db);
    const { rows } = await db.query(`SELECT * FROM "${out}"`);

    assert.equal(rows.length, 3);
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "insert"));
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "update"));
    assert.ok(rows.some((r) => r[META_COLUMNS.op] === "delete"));
  });

  it("chains SQL steps", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "fullname", query: `SELECT *, first_name || ' ' || last_name AS full_name FROM input` }),
      sqlStep({ id: "pick", query: `SELECT _op, _key, _before, id, email, full_name FROM input` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}" WHERE _op != 'delete' ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].full_name, "Alice Smith");
    assert.equal(rows[1].full_name, "Bob Jones");
  });

  it("SQL WHERE filter works", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "filter", query: `SELECT * FROM input WHERE email LIKE '%example%'` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}" ORDER BY id`);
    assert.equal(rows.length, 2);
  });

  it("SQL aggregation works when user provides _op/_key/_before", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "count", query: `SELECT 'aggregate' AS _op, '{}' AS _key, NULL AS _before, count(*) AS total FROM input WHERE _op != 'delete'` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].total), "2");
  });

  it("fn step with function carries _op/_key through", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      fnStep({ id: "upper", transform: (rows) => rows.map((r) => ({ ...r, email: r.email ? String(r.email).toUpperCase() : null })) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}" WHERE _op = 'insert'`);
    assert.equal(rows[0].email, "ALICE@EXAMPLE.COM");
    assert.equal(rows[0][META_COLUMNS.op], "insert");
  });

  it("fn step receives _op and _key alongside data", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    let receivedKeys: string[] = [];
    await runPipeline(pipe("test/users",
      fnStep({ id: "inspect", transform: (rows) => { receivedKeys = Object.keys(rows[0]); return rows; } }),
    ), db);

    assert.ok(receivedKeys.includes("_op"));
    assert.ok(receivedKeys.includes("_key"));
    assert.ok(receivedKeys.includes("email"));
  });

  it("fn step can filter rows", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      fnStep({ id: "filter", transform: (rows) => rows.filter((r) => r.email && String(r.email).includes("example")) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 2);
  });

  it("fn step that drops _op/_key throws", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => runPipeline(pipe("test/users",
        // @ts-expect-error intentionally stripping _op/_key
        fnStep({ id: "bad", transform: (rows) => rows.map(({ _op, _key, ...data }) => data) }),
      ), db),
      (err: Error) => err.message.includes("missing"),
    );
  });

  it("mixes SQL and fn steps", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "filter", query: `SELECT * FROM input WHERE _op != 'delete'` }),
      fnStep({ id: "tag", transform: (rows) => rows.map((r) => ({ ...r, source: "crm" })) }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].source, "crm");
  });

  it("fn step with output schema preserves native types in downstream SQL", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      fnStep({
        id: "typed",
        transform: (rows) => rows.map((r) => ({ ...r, flag: true, count: 42, meta: { tier: "gold" } })),
        output: { id: "string?", email: "string?", first_name: "string?", last_name: "string?", flag: "boolean", count: "number", meta: "json" },
      }),
      sqlStep({
        id: "use-types",
        query: `SELECT _op, _key, _before, id, flag, count + 1 AS incremented, meta->>'tier' AS tier FROM input WHERE flag AND count > 10`,
      }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}" WHERE _op != 'delete' ORDER BY id`);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].flag, true);
    assert.equal(Number(rows[0].incremented), 43);
    assert.equal(rows[0].tier, "gold");
  });

  it("fn step without output schema still JSON-encodes object-valued columns", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      fnStep({
        id: "obj-untyped",
        transform: (rows) => rows.map((r) => ({ ...r, nested: { x: 1, y: "z" } })),
      }),
      sqlStep({ id: "read-json", query: `SELECT _op, _key, _before, id, nested->>'y' AS y FROM input` }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}" WHERE _op != 'delete' LIMIT 1`);
    assert.equal(rows[0].y, "z");
  });

  it("empty pipeline returns source table", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users"), db);
    assert.equal(out, "test/users");
  });

  it("handles all-delete input", async () => {
    db = await createDuckDbQueryStore();
    await db.materialize("test", "users", [
      { table: "users", op: "delete" as const, key: { id: 1 }, row: null },
      { table: "users", op: "delete" as const, key: { id: 2 }, row: null },
    ]);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "pass", query: `SELECT * FROM input` }),
    ), db);
    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r[META_COLUMNS.op] === "delete"));
  });

  it("second run overwrites step tables", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const p = pipe("test/users", sqlStep({ id: "pass", query: `SELECT * FROM input` }));
    await runPipeline(p, db);
    const out = await runPipeline(p, db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 3);
  });
});

describe("_op/_key enforcement", () => {
  it("throws when SQL step drops _op/_key", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => runPipeline(pipe("test/users", sqlStep({ id: "bad", query: `SELECT id, email FROM input` })), db),
      (err: Error) => err.message.includes("missing"),
    );
  });
});

describe("fn step with string transform", () => {
  it("resolves transform from resolver", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const resolver = (name: string) => {
      if (name === "upper-email") return (rows: (Row & Envelope)[]) => rows.map((r) => ({ ...r, email: String(r.email).toUpperCase() }));
      throw new Error(`Unknown transform: ${name}`);
    };

    const out = await runPipeline(
      pipe("test/users", fnStep({ id: "upper", transform: "upper-email" })),
      db, resolver,
    );

    const { rows } = await db.query(`SELECT * FROM "${out}" WHERE _op = 'insert'`);
    assert.equal(rows[0].email, "ALICE@EXAMPLE.COM");
  });

  it("throws when resolver not provided", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => runPipeline(pipe("test/users", fnStep({ id: "bad", transform: "missing" })), db),
      (err: Error) => err.message.includes("no resolver was provided"),
    );
  });

  it("throws when name not in resolver", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => runPipeline(pipe("test/users", fnStep({ id: "bad", transform: "missing" })), db, () => { throw new Error("not found"); }),
      (err: Error) => err.message.includes("not found"),
    );
  });
});

describe("serialization", () => {
  it("pipeline with string transforms round-trips through JSON", () => {
    const p = pipe("crm/users",
      sqlStep({ id: "pick", query: "SELECT _op, _key, _before, id, email FROM input" }),
      sqlStep({ id: "rename", query: "SELECT _op, _key, _before, id AS userId, email FROM input", output: { userId: "string", email: "string" } }),
      fnStep({ id: "enrich", transform: "enrichUsers", input: { userId: "string", email: "string" } }),
    );

    const json = JSON.stringify(p);
    const parsed = JSON.parse(json);

    assert.equal(parsed.source, "crm/users");
    assert.equal(parsed.steps.length, 3);
    assert.equal(parsed.steps[0].kind, "sql");
    assert.equal(parsed.steps[1].output.userId, "string");
    assert.equal(parsed.steps[2].kind, "fn");
    assert.equal(parsed.steps[2].transform, "enrichUsers");
  });

  it("function transforms are dropped by JSON.stringify", () => {
    const p = pipe("test", fnStep({ id: "x", transform: (r) => r }));
    const parsed = JSON.parse(JSON.stringify(p));
    assert.equal(parsed.steps[0].transform, undefined);
  });
});

describe("validatePipeline", () => {
  it("passes for valid SQL steps", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);
    await validatePipeline(pipe("test/users", sqlStep({ id: "ok", query: `SELECT * FROM input` })), db);
  });

  it("throws for SQL referencing nonexistent column", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);
    await assert.rejects(() => validatePipeline(pipe("test/users", sqlStep({ id: "bad", query: `SELECT nope FROM input` })), db));
  });

  it("catches _op/_key drop at validation time", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);
    await assert.rejects(
      () => validatePipeline(pipe("test/users", sqlStep({ id: "bad", query: `SELECT id FROM input` })), db),
      (err: Error) => err.message.includes("missing"),
    );
  });

  it("catches _before drop at validation time", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);
    await assert.rejects(
      () => validatePipeline(pipe("test/users", sqlStep({ id: "bad", query: `SELECT _op, _key, id FROM input` })), db),
      (err: Error) => err.message.includes("_before"),
    );
  });

  it("rejects nested branches at validation time", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);
    const p = pipe("test/users",
      branch("outer",
        [
          branch("inner", [sqlStep({ id: "inside", query: `SELECT _op, _key, _before FROM input` })]),
        ],
      ),
    );
    await assert.rejects(
      () => validatePipeline(p, db),
      (err: Error) => err.message.includes("Nested branch") && err.message.includes("inner") && err.message.includes("outer"),
    );
  });

  it("graphSinkStep requires an explicit id at the type level", () => {
    const T = namespace("https://hash.ai/@test/types");
    // @ts-expect-error `id` is required
    const _missing = graphSinkStep({ entityType: T.entity("x/v/1"), entityId: "id", webId: "w", properties: {} });
    const ok = graphSinkStep({ id: "s", entityType: T.entity("x/v/1"), entityId: "id", webId: "w", properties: {} });
    assert.equal(ok.id, "s");
  });

  it("skips fn steps", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);
    await validatePipeline(pipe("test/users",
      sqlStep({ id: "first", query: `SELECT * FROM input` }),
      fnStep({ id: "middle", transform: (rows) => rows }),
      sqlStep({ id: "last", query: `SELECT * FROM input` }),
    ), db);
  });
});

describe("SchemaDecl validation", () => {
  const UserOut: SchemaDecl = { id: "string", email: "string" };

  it("validates SQL step output columns", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "pick", query: `SELECT _op, _key, _before, id, email FROM input`, output: UserOut }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 3);
  });

  it("catches missing schema column", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => validatePipeline(pipe("test/users", sqlStep({ id: "pick", query: `SELECT _op, _key, _before, id FROM input`, output: { nope: "string" } })), db),
      (err: Error) => err.message.includes("nope"),
    );
  });

  it("fn step validates input via SchemaDecl", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "pick", query: `SELECT _op, _key, _before, id, email FROM input` }),
      fnStep({ id: "check", transform: (rows) => rows, input: { id: "string", email: "string" } }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 3);
  });

  it("catches incompatible input schema", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => validatePipeline(pipe("test/users",
        sqlStep({ id: "pick", query: `SELECT _op, _key, _before, id, email FROM input` }),
        fnStep({ id: "needs-name", transform: (rows) => rows, input: { full_name: "string" } }),
      ), db),
      (err: Error) => err.message.includes("full_name") && err.message.includes("needs-name"),
    );
  });

  it("passes when input schema matches", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await validatePipeline(pipe("test/users",
      sqlStep({ id: "pick", query: `SELECT _op, _key, _before, id, email FROM input` }),
      fnStep({ id: "ok", transform: (rows) => rows, input: { id: "string", email: "string" } }),
    ), db);
  });
});

describe("branch step", () => {
  const T = namespace("https://hash.ai/@test/types");

  it("fan-out: two branches read from the same input", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const sinkCalls: string[] = [];
    const handler: SideEffectHandler = async (step, table) => {
      if (step.kind === "graph-sink") {
        const { rows } = await db.query(`SELECT * FROM "${table}"`);
        sinkCalls.push(`${step.id}:${rows.length}`);
      }
    };

    const p = pipe("test/users",
      branch("fan",
        [
          sqlStep({ id: "emails", query: `SELECT _op, _key, _before, email FROM input` }),
          graphSinkStep({ id: "sink-emails", entityType: T.entity("e/v/1"), entityId: "email", webId: "w", properties: {} }),
        ],
        [
          sqlStep({ id: "names", query: `SELECT _op, _key, _before, first_name FROM input` }),
          graphSinkStep({ id: "sink-names", entityType: T.entity("n/v/1"), entityId: "first_name", webId: "w", properties: {} }),
        ],
      ),
    );

    await runPipeline(p, db, undefined, handler);

    assert.equal(sinkCalls.length, 2);
    assert.ok(sinkCalls[0].startsWith("sink-emails:"));
    assert.ok(sinkCalls[1].startsWith("sink-names:"));
  });

  it("branch is identity on main pipeline flow", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const p = pipe("test/users",
      sqlStep({ id: "add-col", query: `SELECT *, 'before' AS phase FROM input` }),
      branch("fan",
        [sqlStep({ id: "b1", query: `SELECT _op, _key, _before, email FROM input` })],
      ),
      sqlStep({ id: "after", query: `SELECT *, 'after' AS phase2 FROM input` }),
    );

    const out = await runPipeline(p, db);
    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows[0].phase, "before");
    assert.equal(rows[0].phase2, "after");
    assert.ok(rows[0].email);
  });
});

// Compile-time refinement tests. If the refinement regresses, the
// `@ts-expect-error` directives become unused and `npx tsc` fails the build.
describe("pipelines() type refinement", () => {
  it("accepts a valid multi-pipeline declaration", () => {
    const defs = pipelines([
      { source: "organizations", pipeline: pipe("db/organizations", sqlStep({ id: "norm-orgs", query: "SELECT _op, _key FROM input" })) },
      {
        source: "users",
        pipeline: pipe("db/users", sqlStep({ id: "norm-users", query: "SELECT _op, _key FROM input" })),
        dependsOn: ["organizations"],
      },
    ] as const);
    assert.equal(defs.length, 2);
  });

  it("rejects an unknown pipeline-level dependsOn at compile time", () => {
    // @ts-expect-error -- "organizaitons" is a typo; only "organizations" and "users" are declared
    pipelines([
      { source: "organizations", pipeline: pipe("db/organizations", sqlStep({ id: "a", query: "SELECT _op, _key FROM input" })) },
      {
        source: "users",
        pipeline: pipe("db/users", sqlStep({ id: "b", query: "SELECT _op, _key FROM input" })),
        dependsOn: ["organizaitons"],
      },
    ] as const);
  });

  it("rejects an unknown top-level step dependsOn at compile time", () => {
    // @ts-expect-error -- "cleanupp" is a typo; only "clean" and "normalize" exist as step ids
    pipelines([
      {
        source: "users",
        pipeline: pipe("db/users",
          sqlStep({ id: "clean", query: "SELECT _op, _key FROM input" }),
          sqlStep({ id: "normalize", query: "SELECT _op, _key FROM input", dependsOn: ["cleanupp"] }),
        ),
      },
    ] as const);
  });

  it("rejects an unknown step dependsOn inside a branch at compile time", () => {
    // @ts-expect-error -- "norm-airprots" is a typo; real id is "norm-airports"
    pipelines([
      {
        source: "arrivals",
        pipeline: pipe("api/arrivals",
          sqlStep({ id: "cleanup", query: "SELECT _op, _key FROM input" }),
          branch("extract",
            [sqlStep({ id: "norm-airports", query: "SELECT _op, _key FROM input" })],
            [sqlStep({ id: "norm-flights", query: "SELECT _op, _key FROM input", dependsOn: ["norm-airprots"] })],
          ),
        ),
      },
    ] as const);
  });

  it("propagates step ids through deeply nested pipe() composition", () => {
    const stepA = sqlStep({ id: "a-clean", query: "SELECT _op, _key FROM input" });
    const stepB = sqlStep({ id: "b-filter", query: "SELECT _op, _key FROM input WHERE _op != 'delete'" });
    const stepC = sqlStep({ id: "c-enrich", query: "SELECT _op, _key FROM input", dependsOn: ["a-clean"] });

    const deep = pipe(pipe(pipe("db/users", stepA), stepB), stepC);
    const defs = pipelines([{ source: "users", pipeline: deep }] as const);
    assert.equal(defs[0].pipeline.steps.length, 3);
  });

  it("rejects unknown dependsOn pointing at the innermost layer of a deep pipe()", () => {
    const stepA = sqlStep({ id: "layer-a", query: "SELECT _op, _key FROM input" });
    const stepB = sqlStep({ id: "layer-b", query: "SELECT _op, _key FROM input" });
    const deep = pipe(pipe("db/users", stepA), stepB);

    // @ts-expect-error -- "layre-a" is a typo; only "layer-a" and "layer-b" exist
    pipelines([
      {
        source: "users",
        pipeline: pipe(deep, sqlStep({ id: "layer-c", query: "SELECT _op, _key FROM input", dependsOn: ["layre-a"] })),
      },
    ] as const);
  });
});

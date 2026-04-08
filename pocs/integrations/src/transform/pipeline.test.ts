import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDuckDbQueryStore } from "../staging/duckdb.js";
import { META_COLUMNS, type QueryableStore } from "../staging/types.js";
import { pipe, sqlStep, fnStep, type Row, type Envelope, type SchemaDecl } from "./pipeline.js";
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
      sqlStep({ id: "pick", query: `SELECT _op, _key, id, email, full_name FROM input` }),
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

  it("SQL aggregation works when user provides _op/_key", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "count", query: `SELECT 'aggregate' AS _op, '{}' AS _key, count(*) AS total FROM input WHERE _op != 'delete'` }),
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
      sqlStep({ id: "pick", query: "SELECT _op, _key, id, email FROM input" }),
      sqlStep({ id: "rename", query: "SELECT _op, _key, id AS userId, email FROM input", output: { userId: "string", email: "string" } }),
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
      sqlStep({ id: "pick", query: `SELECT _op, _key, id, email FROM input`, output: UserOut }),
    ), db);

    const { rows } = await db.query(`SELECT * FROM "${out}"`);
    assert.equal(rows.length, 3);
  });

  it("catches missing schema column", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await assert.rejects(
      () => validatePipeline(pipe("test/users", sqlStep({ id: "pick", query: `SELECT _op, _key, id FROM input`, output: { nope: "string" } })), db),
      (err: Error) => err.message.includes("nope"),
    );
  });

  it("fn step validates input via SchemaDecl", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    const out = await runPipeline(pipe("test/users",
      sqlStep({ id: "pick", query: `SELECT _op, _key, id, email FROM input` }),
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
        sqlStep({ id: "pick", query: `SELECT _op, _key, id, email FROM input` }),
        fnStep({ id: "needs-name", transform: (rows) => rows, input: { full_name: "string" } }),
      ), db),
      (err: Error) => err.message.includes("full_name") && err.message.includes("needs-name"),
    );
  });

  it("passes when input schema matches", async () => {
    db = await createDuckDbQueryStore();
    await seedUsers(db);

    await validatePipeline(pipe("test/users",
      sqlStep({ id: "pick", query: `SELECT _op, _key, id, email FROM input` }),
      fnStep({ id: "ok", transform: (rows) => rows, input: { id: "string", email: "string" } }),
    ), db);
  });
});

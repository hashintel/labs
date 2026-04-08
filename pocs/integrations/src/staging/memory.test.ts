import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMemoryEventStore } from "./memory.js";
import type { ChangeEvent } from "../connector/types.js";

function ev(table: string, op: ChangeEvent["op"], key: Record<string, unknown>, row: Record<string, unknown> | null): ChangeEvent {
  return { table, op, key, row };
}

describe("MemoryEventStore", () => {
  it("append + read round-trips", async () => {
    const store = createMemoryEventStore();
    await store.append("c", "users", [ev("users", "insert", { id: 1 }, { id: "1" })]);
    const { events, nextSeq } = await store.read("c", "users");
    assert.equal(events.length, 1);
    assert.equal(nextSeq, 1);
  });

  it("empty append is a no-op", async () => {
    const store = createMemoryEventStore();
    await store.append("c", "users", []);
    const { events } = await store.read("c", "users");
    assert.equal(events.length, 0);
  });

  it("read with fromSeq skips earlier events", async () => {
    const store = createMemoryEventStore();
    await store.append("c", "users", [
      ev("users", "insert", { id: 1 }, { id: "1" }),
      ev("users", "insert", { id: 2 }, { id: "2" }),
    ]);
    const { events } = await store.read("c", "users", 1);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].key, { id: 2 });
  });

  it("incremental reads via nextSeq", async () => {
    const store = createMemoryEventStore();
    await store.append("c", "users", [
      ev("users", "insert", { id: 1 }, { id: "1" }),
      ev("users", "insert", { id: 2 }, { id: "2" }),
    ]);
    const r1 = await store.read("c", "users");
    assert.equal(r1.nextSeq, 2);

    await store.append("c", "users", [ev("users", "insert", { id: 3 }, { id: "3" })]);
    const r2 = await store.read("c", "users", r1.nextSeq);
    assert.equal(r2.events.length, 1);
    assert.equal(r2.nextSeq, 3);
  });

  it("trim frees memory and preserves seq stability", async () => {
    const store = createMemoryEventStore();
    await store.append("c", "users", [
      ev("users", "insert", { id: 1 }, { id: "1" }),
      ev("users", "insert", { id: 2 }, { id: "2" }),
      ev("users", "insert", { id: 3 }, { id: "3" }),
    ]);
    store.trim("c", "users", 2);

    const { events, nextSeq } = await store.read("c", "users", 2);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].key, { id: 3 });
    assert.equal(nextSeq, 3);
  });

  it("trim is idempotent", async () => {
    const store = createMemoryEventStore();
    await store.append("c", "users", [ev("users", "insert", { id: 1 }, { id: "1" })]);
    store.trim("c", "users", 1);
    store.trim("c", "users", 1);
    const { events } = await store.read("c", "users", 1);
    assert.equal(events.length, 0);
  });
});

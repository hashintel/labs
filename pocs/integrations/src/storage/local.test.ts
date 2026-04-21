import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage } from "./local.js";

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("round-trips put/get/exists/remove", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });

    assert.equal(await s.exists("a.txt"), false);
    assert.equal(await s.get("a.txt"), null);

    await s.put("a.txt", new TextEncoder().encode("hello"));
    assert.equal(await s.exists("a.txt"), true);
    const bytes = await s.get("a.txt");
    assert.equal(new TextDecoder().decode(bytes!), "hello");

    await s.remove("a.txt");
    assert.equal(await s.exists("a.txt"), false);
  });

  it("creates nested directories on put", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    await s.put("deeply/nested/path/file.bin", new Uint8Array([1, 2, 3]));
    const bytes = await s.get("deeply/nested/path/file.bin");
    assert.deepEqual(Array.from(bytes!), [1, 2, 3]);
  });

  it("list returns relative keys under a prefix, empty when prefix missing", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    await s.put("checkpoints/a.parquet", new Uint8Array([1]));
    await s.put("checkpoints/nested/b.parquet", new Uint8Array([2]));
    await s.put("other/c.parquet", new Uint8Array([3]));

    const cp = (await s.list("checkpoints")).sort();
    assert.deepEqual(cp, ["checkpoints/a.parquet", "checkpoints/nested/b.parquet"]);
    assert.deepEqual(await s.list("does-not-exist"), []);
  });

  it("rejects keys with .. or absolute paths", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    await assert.rejects(() => s.put("../escape", new Uint8Array([])));
    await assert.rejects(() => s.put("/abs/path", new Uint8Array([])));
  });

  it("uriFor returns an absolute path DuckDB can use", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    const uri = s.uriFor("checkpoints/x.parquet");
    assert.ok(uri.startsWith(root));
    assert.ok(uri.endsWith("/checkpoints/x.parquet"));
  });

  it("put is atomic: no tmp leftover, target replaced in place", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    await s.put("a.bin", new Uint8Array([1]));
    await s.put("a.bin", new Uint8Array([2]));
    const bytes = await s.get("a.bin");
    assert.deepEqual(Array.from(bytes!), [2]);
    const all = await s.list("");
    assert.ok(all.every((k) => !k.includes(".tmp-")), "no .tmp- files should remain");
  });
});

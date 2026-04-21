import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalStorage } from "./local.js";

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("exists() reports false for missing keys and true once prepareWrite runs + a file is present", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });

    assert.equal(await s.exists("a.txt"), false);

    await s.prepareWrite("a.txt");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(s.uriFor("a.txt"), "hello");

    assert.equal(await s.exists("a.txt"), true);
  });

  it("prepareWrite creates nested parent directories", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    await s.prepareWrite("deeply/nested/path/file.bin");
    const dir = join(root, "deeply", "nested", "path");
    assert.ok(existsSync(dir));
  });

  it("rejects keys with .. or absolute paths", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    await assert.rejects(() => s.prepareWrite("../escape"));
    await assert.rejects(() => s.prepareWrite("/abs/path"));
  });

  it("uriFor returns an absolute path DuckDB can use", async () => {
    root = mkdtempSync(join(tmpdir(), "ls-"));
    const s = createLocalStorage({ root });
    const uri = s.uriFor("checkpoints/x.parquet");
    assert.ok(uri.startsWith(root));
    assert.ok(uri.endsWith("/checkpoints/x.parquet"));
  });

  it("prepare creates the root directory", async () => {
    const parent = mkdtempSync(join(tmpdir(), "ls-"));
    root = join(parent, "nested-root");
    const s = createLocalStorage({ root });
    assert.equal(existsSync(root), false);
    await s.prepare({} as never);
    assert.ok(existsSync(root));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "./config.js";

function policyFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "runner-cfg-"));
  const path = join(dir, "runner.config.yaml");
  writeFileSync(path, body);
  return path;
}

describe("loadPolicy", () => {
  it("a missing file yields throttling/admission off", () => {
    assert.deepEqual(loadPolicy(join(tmpdir(), "does-not-exist-runner.yaml")), {
      webOpsPerSec: undefined,
      overrides: {},
      maxConcurrentRuns: undefined,
    });
  });

  it("reads the default budget, per-web overrides, and admission slots", () => {
    const path = policyFile(`
writeBudget:
  webOpsPerSec: 1000
  overrides:
    web-aaa: 1500
    web-bbb: 500
maxConcurrentRuns: 8
`);
    assert.deepEqual(loadPolicy(path), {
      webOpsPerSec: 1000,
      overrides: { "web-aaa": 1500, "web-bbb": 500 },
      maxConcurrentRuns: 8,
    });
  });

  it("a file with no writeBudget is valid (everything off)", () => {
    const path = policyFile(`maxConcurrentRuns: 4\n`);
    assert.deepEqual(loadPolicy(path), { webOpsPerSec: undefined, overrides: {}, maxConcurrentRuns: 4 });
  });

  it("rejects a non-positive rate with a located error", () => {
    const path = policyFile(`writeBudget:\n  webOpsPerSec: 0\n`);
    assert.throws(() => loadPolicy(path), /writeBudget\.webOpsPerSec must be a positive number/);
  });

  it("rejects a non-positive override with the offending key named", () => {
    const path = policyFile(`writeBudget:\n  overrides:\n    sap: -3\n`);
    assert.throws(() => loadPolicy(path), /writeBudget\.overrides\.sap must be a positive number/);
  });
});

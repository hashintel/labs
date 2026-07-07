import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retryAfterMs, with429Retry } from "./http-retry.js";

function resp(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("retryAfterMs", () => {
  it("integer Retry-After wins, in seconds, capped at 30s", () => {
    assert.equal(retryAfterMs(resp(429, { "retry-after": "2" }), 0), 2000);
    assert.equal(retryAfterMs(resp(429, { "retry-after": "9999" }), 0), 30_000);
    assert.equal(retryAfterMs(resp(429, { "retry-after": " 3 " }), 5), 3000);
  });

  it("absent or HTTP-date header falls back to capped exponential backoff", () => {
    assert.equal(retryAfterMs(resp(429), 0), 500);
    assert.equal(retryAfterMs(resp(429), 3), 4000);
    assert.equal(retryAfterMs(resp(429), 10), 30_000);
    assert.equal(retryAfterMs(resp(429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }), 1), 1000);
  });
});

describe("with429Retry", () => {
  it("retries 429s then returns the first non-429", async () => {
    let calls = 0;
    const res = await with429Retry(async () => {
      calls++;
      return calls < 3 ? resp(429, { "retry-after": "0" }) : resp(200);
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  });

  it("returns the 429 after the attempt budget for the caller's error path", async () => {
    let calls = 0;
    const res = await with429Retry(async () => {
      calls++;
      return resp(429, { "retry-after": "0" });
    });
    assert.equal(res.status, 429);
    assert.equal(calls, 11);
  });

  it("non-429 outcomes pass through untouched, including errors", async () => {
    assert.equal((await with429Retry(async () => resp(503))).status, 503);
    await assert.rejects(
      with429Retry(async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
  });
});

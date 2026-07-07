// Bounded retry on HTTP 429 honoring Retry-After, shared by the graph client
// (write side) and REST fetches (fetch side); semantics match the Elixir port's
// Http.Retry. An integer Retry-After wins, capped; an HTTP-date or absent header
// falls back to capped exponential backoff. After the attempt budget the 429
// response is returned as-is for the caller's normal error path.

const MAX_ATTEMPTS = 10;
const MAX_RETRY_AFTER_MS = 30_000;

export async function with429Retry(requestFn: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await requestFn();
    if (res.status !== 429 || attempt >= MAX_ATTEMPTS) return res;
    await res.body?.cancel().catch(() => {});
    await sleep(retryAfterMs(res, attempt));
  }
}

export function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after")?.trim();
  if (header && /^\d+$/.test(header)) {
    return Math.min(Number(header) * 1000, MAX_RETRY_AFTER_MS);
  }
  return Math.min(500 * 2 ** attempt, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Process-wide per-host fetch pacing: every endpoint (and every concurrently
// running integration in this process) hitting the same host shares one send
// schedule. Reservation is synchronous, so concurrent callers cannot double-book
// a slot; the first request on an idle host goes immediately (preserving the
// historical skip-first-page rateLimitMs behavior). Cross-process pacing is
// deliberately out of scope: source APIs are rarely shared across runs.

const schedule = new Map<string, number>();

export async function paceHost(host: string, intervalMs: number): Promise<void> {
  if (intervalMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, schedule.get(host) ?? 0);
  schedule.set(host, slot + intervalMs);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

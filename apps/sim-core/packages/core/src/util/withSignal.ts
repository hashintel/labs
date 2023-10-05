/**
 * Connect a dispatched action to an existing abort signal
 */
export function withSignal<T>(
  promise: Promise<T> & { abort(reason?: string): void },
  signal?: AbortSignal
) {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    promise.abort();
  } else {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      promise.abort();
    };

    signal.addEventListener("abort", onAbort);
  }

  return promise;
}

export const setSignalTimeout = (
  handler: Function,
  ms: number,
  signal: AbortSignal,
) => {
  const timeout = setTimeout(() => {
    if (!signal.aborted) {
      handler();
    }
  }, ms);

  signal.addEventListener("abort", () => {
    clearTimeout(timeout);
  });

  if (signal.aborted) {
    clearTimeout(timeout);
  }

  return timeout;
};

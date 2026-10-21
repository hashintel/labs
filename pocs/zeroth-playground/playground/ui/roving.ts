/**
 * Where the arrow keys move the focus in a list of options: ArrowDown and
 * ArrowUp step from `at`, Home and End jump to the ends, and the result stays
 * within the list. `null` for any other key, so the caller leaves it alone.
 */
export function stepIndex(key: string, at: number, count: number): number | null {
  const next =
    key === "ArrowDown"
      ? at + 1
      : key === "ArrowUp"
        ? at - 1
        : key === "Home"
          ? 0
          : key === "End"
            ? count - 1
            : null;
  return next === null ? null : Math.max(0, Math.min(count - 1, next));
}

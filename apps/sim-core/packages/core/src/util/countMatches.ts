export const countMatches = <T>(
  arr: T[],
  predicate: (item: T) => boolean
): number =>
  arr.reduce((count, item) => (predicate(item) ? count + 1 : count), 0);

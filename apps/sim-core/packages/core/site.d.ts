/**
 * provided by vite
 * @see: ./vite.config.ts
 */
declare var BUILD_STAMP: string;

/**
 * Like `Omit` but distributes over unions
 * @see https://davidgomes.com/pick-omit-over-union-types-in-typescript/
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * Like `Pick` but distributes over unions
 * @see https://davidgomes.com/pick-omit-over-union-types-in-typescript/
 */
type DistributivePick<T, K extends keyof T> = T extends unknown
  ? Pick<T, K>
  : never;

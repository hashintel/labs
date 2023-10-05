/**
 * provided by webpack build
 * @see: ./webpack.config.js
 */
declare var WEBPACK_PUBLIC_PATH: string;
declare var WEBPACK_BUILD_STAMP: string;
declare var LOCAL_API: boolean;
declare var MAPBOX_API_TOKEN: string;

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

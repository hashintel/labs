/**
 * Build-time globals provided by Vite's `define` config.
 * @see ./vite.config.ts
 */
declare var WEBPACK_PUBLIC_PATH: string;
declare var WEBPACK_BUILD_STAMP: string;
declare var LOCAL_API: boolean;
declare var MAPBOX_API_TOKEN: string;

/**
 * Vite raw import suffix — importing with ?raw returns file contents as string.
 */
declare module "*.d.ts?raw" {
  const content: string;
  export default content;
}

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

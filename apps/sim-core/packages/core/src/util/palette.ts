import * as o from "fp-ts/es6/Option";

import { mod } from "./math";
import { themeNumbers } from "./theme";

export const mapColor: (src: string, sd?: string) => o.Option<number> = (
  src,
  seed,
) =>
  o.fromNullable(
    src === "random"
      ? themeColor(
          mod(hashNum(seed ?? Math.random().toString(36).substring(7)), 1),
        )
      : src === "primary"
        ? themeNumbers.purple
        : src === "accent"
          ? themeNumbers.green
          : !isNaN(Number(src))
            ? themeColor(mod(Number(src) / themeBase.length, 1))
            : Object.prototype.hasOwnProperty.call(themeNumbers, src)
              ? themeNumbers[src]
              : undefined,
  );

const themeBase = [
  themeNumbers.purple,
  themeNumbers["purple-hover"],
  themeNumbers["purple-light"],
  themeNumbers.blue,
  themeNumbers.pink,
  themeNumbers.green,
  themeNumbers.yellow,
  themeNumbers.red,
];

const shiftedBase = (shift: number, idx: number) =>
  ((0xff << (shift * 4)) & themeBase[idx]) >> (shift * 4);

// Transform a value from 0 to 1 into a lerped color from themeBase
const themeColor: (r: number) => number = (val) => {
  const start = Math.floor(val * themeBase.length);
  const end = (start + 1) % themeBase.length;
  const lerpValue = val * themeBase.length - start;
  const red =
    shiftedBase(4, end) * lerpValue + shiftedBase(4, start) * (1 - lerpValue);
  const green =
    shiftedBase(2, end) * lerpValue + shiftedBase(2, start) * (1 - lerpValue);
  const blue =
    shiftedBase(0, end) * lerpValue + shiftedBase(0, start) * (1 - lerpValue);

  return (
    ((red & 0xff) << (4 * 4)) + ((green & 0xff) << (2 * 4)) + (blue & 0xff)
  );
};

// From https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
const hash = (str: string) => {
  let hash = 0,
    idx,
    chr;
  if (str.length === 0) return hash;
  for (idx = 0; idx < str.length; idx++) {
    chr = str.charCodeAt(idx);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

const int32 = 2 ** 31;
const hashNum = (str: string): number => hash(str) / int32;
